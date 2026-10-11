// 一对一通话的标签页侧：状态机、RTCPeerConnection、信令与本地媒体。
// RTCPeerConnection 不能在 Dedicated Worker 里用，所以通话放在发起或接听的那个标签页里，
// 同步 Worker 记下这个标签页，只把信令转给它。见 docs/architecture/07-client.md § 通话、docs/adr/0009
import { useSyncExternalStore } from 'react'
import { CALL_GRACE_MS, isMissedCall, randomToken, type Call, type CallResult, type IceServer } from 'shared/protocol'

import { toast } from '@/components/ui/toast'
import { openCamera, type Camera } from '@/features/av/camera'
import { openMicrophone, type Microphone } from '@/features/av/microphone'
import { inPip } from '@/features/pip/pip'
import { blockReload } from '@/lib/reload'
import { call as op, onCall, onCallSignal, onReady, OpFailure } from '@/sync/client'
import { playRingback, playRingtone, type Tone } from './tones'

/**
 * idle：没有通话；incoming：来电在响（每个标签页都显示）；outgoing：呼出、等对方接听；
 * connecting：已接听、正在建立连接；active：已接通；ended：刚结束，短暂显示结果后回到 idle
 */
type Phase = 'idle' | 'incoming' | 'outgoing' | 'connecting' | 'active' | 'ended'

/** 对方的媒体开关，经 DataChannel 告知 */
type PeerMedia = { mic: boolean; camera: boolean; screen: boolean }

export type CallView = {
  phase: Phase
  call: Call | null
  /** 对方 */
  peerId: string | null
  /** 接通的时间（时长从这里算）与结束的时间 */
  connectedAt: number | null
  endedAt: number | null
  mic: boolean
  camera: MediaStream | null
  screen: MediaStream | null
  peer: PeerMedia
  /** 对方的声音、摄像头与屏幕，各一个流 */
  remote: { audio: MediaStream; camera: MediaStream; screen: MediaStream } | null
  /** 通话界面收成头部的通话条 */
  minimized: boolean
  /** 结束时显示的结果；null 为本端出错或连接失败 */
  result: CallResult | null
  /** 结束的原因（出错时） */
  error: string | null
}

const IDLE: CallView = {
  phase: 'idle',
  call: null,
  peerId: null,
  connectedAt: null,
  endedAt: null,
  mic: true,
  camera: null,
  screen: null,
  peer: { mic: true, camera: false, screen: false },
  remote: null,
  minimized: false,
  result: null,
  error: null,
}

/** 收发器的顺序：麦克风、摄像头、屏幕。一开始就全部建好，开关摄像头与屏幕共享只换轨道，不重新协商 */
const SLOTS = ['audio', 'camera', 'screen'] as const
/** 接听后等对方的 offer、或发出 offer 后等连通，超过这个时间就挂断 */
const CONNECT_TIMEOUT_MS = 30_000
/** 连接断开后多久还没恢复就重启 ICE */
const DISCONNECTED_RESTART_MS = 4000
/** 结果显示多久后收起 */
const ENDED_LINGER_MS = 2500
/** 信令没送到时的重试间隔（对方的设备可能正在重连） */
const SIGNAL_RETRY_MS = [500, 1000, 2000, 4000, 8000]
/** 不做 trickle ICE：等候选收集完（或超时）再一次性发出 SDP，信令只要一来一回 */
const GATHER_TIMEOUT_MS = 3000

type Signal = { t: 'offer' | 'answer'; sdp: string } | { t: 'restart' }

let view: CallView = IDLE
const listeners = new Set<() => void>()
// 通话中不重载页面（发布了新版本时）
blockReload(() => view.phase !== 'idle')

function set(patch: Partial<CallView>) {
  view = { ...view, ...patch }
  for (const listener of listeners) listener()
}

export function useCall(): CallView {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => view,
  )
}

// ---------- 本标签页的连接 ----------

let me = ''
let pc: RTCPeerConnection | null = null
let channel: RTCDataChannel | null = null
/** 本次通话的 ICE 服务器；null 表示呼叫的请求还没返回，这时对方接听了也先别连 */
let iceServers: IceServer[] | null = null
let relayOnly = false
let mic: Microphone | null = null
let camera: Camera | null = null
let tone: Tone | null = null
let connectTimer: ReturnType<typeof setTimeout> | undefined
let restartTimer: ReturnType<typeof setTimeout> | undefined
/** 连接断了以后多久还没恢复就挂断（对方的标签页可能没挂断就没了） */
let lostTimer: ReturnType<typeof setTimeout> | undefined
let lingerTimer: ReturnType<typeof setTimeout> | undefined
/** 本标签页是通话所在的标签页 */
let owner = false
/** 连接建好之前到达的信令（被叫方接听后，主叫方的 offer 可能先于接听的结果到达） */
let queued: Signal[] = []

const isCaller = () => view.call?.caller_id === me

/** 只在顶层窗口里接通话；画中画小窗里的页面不参与 */
export function startCalls(userId: string) {
  if (inPip || me) return
  me = userId
  onCall(onCallState)
  onCallSignal((callId, data) => {
    if (view.call?.call_id === callId) void unpack(data).then(onSignal)
  })
  // 换了同步 Worker：告诉它通话在本标签页。新 Worker 向服务端问过之前不知道有通话，
  // 这时的"没有通话"不算数，等它问过以后广播的结果
  onReady(() => {
    if (owner && view.call) void op('claimCall', { callId: view.call.call_id })
    void op('callState', {}).then(({ call, tab }) => call && onCallState(call, tab))
  })
  void op('callState', {}).then(({ call, tab }) => onCallState(call, tab))
  // 关掉标签页时尽量挂断；没送出去的由对方的连接断开后挂断
  addEventListener('pagehide', () => {
    if (owner && view.call) void op('endCall', { chatId: view.call.chat_id, callId: view.call.call_id })
  })
}

/** 同步 Worker 告知的通话状态 */
function onCallState(call: Call | null, _tab: string | null) {
  const cur = view.call
  if (!call) {
    // 离线期间结束了：没有结果可显示
    if (cur && view.phase !== 'ended') finish(null, null)
    return
  }
  if (cur && cur.call_id !== call.call_id) {
    // 别的通话（忙线时的旧来电结束之类）与本标签页无关；正在通话时来的新电话由服务端判为忙线
    if (call.state === 'ringing' && view.phase === 'idle') set({ ...IDLE, phase: 'incoming', call, peerId: call.caller_id })
    return
  }
  switch (call.state) {
    case 'ringing':
      if (!cur && call.callee_id === me) {
        set({ ...IDLE, phase: 'incoming', call, peerId: call.caller_id })
        tone ??= playRingtone()
      }
      return
    case 'active':
      // 本设备其他标签页、或其他设备上进行中的通话，不显示
      if (!cur) return
      set({ call })
      if (!owner) {
        // 在别的设备或标签页接听了
        if (view.phase === 'incoming') reset()
        return
      }
      if (isCaller() && view.phase === 'outgoing' && iceServers) void connectAsCaller()
      return
    case 'ended':
      if (cur && view.phase !== 'ended') {
        if (view.phase === 'incoming' && call.result && !isMissedCall(call.result) && !owner) reset()
        else finish(call.result ?? null, null)
      }
      return
  }
}

// ---------- 发起、接听、挂断 ----------

/** 呼叫私聊对象；必须在用户操作里调用（取麦克风要授权）。relay：对方不是我的联系人，只走中继 */
export async function startCall(chatId: string, peerId: string, relay: boolean): Promise<void> {
  if (view.phase !== 'idle' && view.phase !== 'ended') return
  clearTimeout(lingerTimer)
  const callId = randomToken()
  set({ ...IDLE, phase: 'outgoing', peerId, call: { call_id: callId, chat_id: chatId, caller_id: me, callee_id: peerId, state: 'ringing', started_at: Date.now() } })
  owner = true
  relayOnly = relay
  iceServers = null
  /** 等待期间可能已经挂断 */
  const pending = () => view.phase === 'outgoing' && view.call?.call_id === callId
  try {
    const opened = await getMic()
    if (!pending()) return opened.close()
    mic = opened
    const res = await op('startCall', { chatId, callId })
    iceServers = res.iceServers
    if (!pending()) {
      // 等待期间挂断了：那时服务端还没有这个通话，现在补上挂断
      if (res.call.call_id === callId && res.call.state !== 'ended') void op('endCall', { chatId, callId }).catch(() => {})
      return
    }
    // 签发 TURN 凭据较慢，对方可能已经接听，接听的通知先到了
    const call = view.call?.call_id === res.call.call_id && view.call.state !== 'ringing' ? view.call : res.call
    if (call.state === 'ended') return finish(call.result ?? null, null)
    if (call.caller_id !== me) {
      // 对方正好在呼叫我：转成来电
      releaseLocal()
      owner = false
      set({ ...IDLE, phase: 'incoming', call, peerId: call.caller_id })
      tone = playRingtone()
      return
    }
    set({ call })
    tone = playRingback()
    if (call.state === 'active') void connectAsCaller()
  } catch (e) {
    fail(e)
  }
}

/** 接听来电；relay 同 startCall */
export async function acceptCall(relay: boolean): Promise<void> {
  const call = view.call
  if (view.phase !== 'incoming' || !call) return
  stopTone()
  owner = true
  relayOnly = relay
  set({ phase: 'connecting' })
  try {
    mic = await getMic()
    const res = await op('acceptCall', { chatId: call.chat_id, callId: call.call_id })
    iceServers = res.iceServers
    set({ call: res.call })
    createConnection()
    // 等主叫方的 offer
    connectTimer = setTimeout(() => void hangUp(), CONNECT_TIMEOUT_MS)
  } catch (e) {
    fail(e)
  }
}

/** 挂断、拒绝或取消，由服务端按状态判定 */
export async function hangUp(): Promise<void> {
  const call = view.call
  if (!call || view.phase === 'ended' || view.phase === 'idle') return
  const declining = view.phase === 'incoming'
  finish(declining ? 'declined' : hangUpResult(), null)
  try {
    await op('endCall', { chatId: call.chat_id, callId: call.call_id })
  } catch {
    // 离线：对方的连接断开后自己会挂断，服务端在设备断线期满后结束
  }
}

/** 自己挂断时先显示的结果，服务端的结果到了再以它为准 */
function hangUpResult(): CallResult {
  if (view.phase === 'active' || view.phase === 'connecting') return 'ended'
  return 'canceled'
}

export function setMinimized(minimized: boolean) {
  set({ minimized })
}

// ---------- 媒体开关 ----------

export function toggleMic() {
  const on = !view.mic
  if (mic) mic.enabled = on
  set({ mic: on })
  sendState()
}

export async function toggleCamera() {
  if (camera) {
    camera.close()
    camera = null
    await sender('camera')?.replaceTrack(null)
    set({ camera: null })
  } else {
    try {
      const opened = await openCamera()
      // 等授权期间挂断了
      if (view.phase !== 'active' && view.phase !== 'connecting') return opened.close()
      camera = opened
      // 换了摄像头（选了别的、前后翻转、插拔）：换轨道，不重新协商
      opened.onStream = (stream) => {
        void sender('camera')?.replaceTrack(stream.getVideoTracks()[0]!)
        set({ camera: stream })
      }
      await sender('camera')?.replaceTrack(opened.track)
      set({ camera: opened.stream })
    } catch (e) {
      // 通话还在继续，用 Toast 提示（view.error 只在结束界面上显示）
      console.warn("couldn't turn on the camera", e)
      toast.add({
        type: 'error',
        title: "Couldn't turn on the camera",
        description: e instanceof DOMException && e.name === 'NotAllowedError' ? 'Permission was denied.' : undefined,
      })
      return
    }
  }
  sendState()
}

/** 前后摄像头互换（手机） */
export function flipCamera() {
  camera?.flip()
}

export const screenShareSupported = typeof navigator.mediaDevices?.getDisplayMedia === 'function'

export async function toggleScreen() {
  if (view.screen) return stopScreen()
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    const track = stream.getVideoTracks()[0]!
    track.contentHint = 'detail'
    // 用户在浏览器自带的"停止共享"里结束
    track.addEventListener('ended', () => void stopScreen())
    await sender('screen')?.replaceTrack(track)
    set({ screen: stream })
    sendState()
  } catch {
    // 用户取消了选择
  }
}

async function stopScreen() {
  if (!view.screen) return
  stopStream(view.screen)
  await sender('screen')?.replaceTrack(null)
  set({ screen: null })
  sendState()
}

function sender(slot: (typeof SLOTS)[number]): RTCRtpSender | undefined {
  return pc?.getTransceivers()[SLOTS.indexOf(slot)]?.sender
}

/** 把本端的开关告诉对方；DataChannel 还没开时，开了之后再发 */
function sendState() {
  if (channel?.readyState !== 'open') return
  channel.send(JSON.stringify({ mic: view.mic, camera: view.camera !== null, screen: view.screen !== null } satisfies PeerMedia))
}

// ---------- 连接 ----------

function createConnection() {
  const servers = iceServers ?? []
  const hasRelay = servers.some((s) => [s.urls].flat().some((u) => u.startsWith('turn')))
  let policy: RTCIceTransportPolicy = relayOnly ? 'relay' : 'all'
  if (relayOnly && !hasRelay) {
    // 开发环境可能没有配置 TURN key：退回直连，便于本地调试
    if (!import.meta.env.DEV) throw new CallError("Calls with people who aren't your contacts need a relay server, which isn't available")
    console.warn('no TURN server configured: calling a non-contact without relay')
    policy = 'all'
  }
  const conn = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: policy, bundlePolicy: 'max-bundle' })
  pc = conn
  set({ remote: { audio: new MediaStream(), camera: new MediaStream(), screen: new MediaStream() } })

  conn.ontrack = (e) => {
    const slot = SLOTS[conn.getTransceivers().indexOf(e.transceiver)]
    if (!slot || pc !== conn || !view.remote) return
    // 每次换一条带着轨道的新流：先挂空流、之后再 addTrack 的 <audio autoPlay> 在 Chrome 里不会开始播放
    set({ remote: { ...view.remote, [slot]: new MediaStream([e.track]) } })
  }
  conn.onconnectionstatechange = () => {
    if (pc !== conn) return
    const state = conn.connectionState
    if (state === 'connected') {
      clearTimeout(connectTimer)
      clearTimeout(restartTimer)
      clearTimeout(lostTimer)
      lostTimer = undefined
      stopTone()
      set({ phase: 'active', connectedAt: view.connectedAt ?? Date.now() })
      return
    }
    if (state !== 'disconnected' && state !== 'failed') return
    // 接通过的连接断了：先试着重启 ICE，一直恢复不了就挂断
    if (view.connectedAt !== null) lostTimer ??= setTimeout(() => void hangUp(), CALL_GRACE_MS)
    clearTimeout(restartTimer)
    if (state === 'failed') restartIce()
    else restartTimer = setTimeout(restartIce, DISCONNECTED_RESTART_MS)
  }

  // 双方各建一个协商好的通道，不需要再等 ondatachannel
  channel = conn.createDataChannel('state', { negotiated: true, id: 0 })
  channel.onopen = sendState
  channel.onmessage = (e) => set({ peer: JSON.parse(e.data as string) as PeerMedia })

  for (const s of queued.splice(0)) void onSignal(s)
}

/** 主叫方：对方接听后建好三个收发器并发出 offer */
async function connectAsCaller() {
  if (pc) return
  stopTone()
  set({ phase: 'connecting' })
  try {
    createConnection()
    const conn = pc!
    conn.addTransceiver(mic!.track, { direction: 'sendrecv' })
    conn.addTransceiver('video', { direction: 'sendrecv' })
    conn.addTransceiver('video', { direction: 'sendrecv' })
    connectTimer = setTimeout(() => void hangUp(), CONNECT_TIMEOUT_MS)
    await sendOffer()
  } catch (e) {
    fail(e)
  }
}

async function sendOffer(iceRestart = false) {
  const conn = pc
  if (!conn) return
  await conn.setLocalDescription(await conn.createOffer({ iceRestart }))
  await gathered(conn)
  await signal({ t: 'offer', sdp: conn.localDescription!.sdp })
}

/**
 * 连接断了：主叫方重启 ICE（重新协商），被叫方请主叫方来重启，免得双方同时发 offer。
 * 上一轮协商还没完成时不再发起；失败只记日志，等下一次断开或挂断计时器
 */
function restartIce() {
  clearTimeout(restartTimer)
  if (!pc || view.phase === 'ended' || pc.signalingState !== 'stable') return
  const retry = isCaller() ? sendOffer(true) : signal({ t: 'restart' })
  retry.catch((e: unknown) => console.warn('ice restart failed', e))
}

async function onSignal(s: Signal) {
  const conn = pc
  if (!conn) {
    if (owner) queued.push(s)
    return
  }
  try {
    if (s.t === 'offer') {
      await conn.setRemoteDescription({ type: 'offer', sdp: s.sdp })
      // 收发器随 offer 建立，默认只收：改成收发，放上麦克风
      const transceivers = conn.getTransceivers()
      for (const t of transceivers) t.direction = 'sendrecv'
      if (!transceivers[0]?.sender.track) await transceivers[0]?.sender.replaceTrack(mic!.track)
      await conn.setLocalDescription(await conn.createAnswer())
      await gathered(conn)
      await signal({ t: 'answer', sdp: conn.localDescription!.sdp })
    } else if (s.t === 'answer') {
      await conn.setRemoteDescription({ type: 'answer', sdp: s.sdp })
    } else if (isCaller()) {
      restartIce()
    }
  } catch (e) {
    // 接通之后的重新协商出错不挂断，等下一次重启 ICE 或挂断计时器
    if (view.connectedAt !== null) console.warn('renegotiation failed', e)
    else fail(e)
  }
}

/** 等候选收集完；超时就带着已有的候选发出去 */
function gathered(conn: RTCPeerConnection): Promise<void> {
  if (conn.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      conn.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => {
      if (conn.iceGatheringState === 'complete') done()
    }
    const timer = setTimeout(done, GATHER_TIMEOUT_MS)
    conn.addEventListener('icegatheringstatechange', check)
  })
}

/** 发信令；对方的设备没连上时稍后重试，都没送到就算失败 */
async function signal(s: Signal) {
  const call = view.call!
  const data = await pack(s)
  for (const delay of [0, ...SIGNAL_RETRY_MS]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    if (view.call?.call_id !== call.call_id || view.phase === 'ended') return
    if (await op('signal', { chatId: call.chat_id, callId: call.call_id, data })) return
  }
  throw new CallError("Couldn't reach the other device")
}

/**
 * 信令压缩后再发：不做 trickle ICE 的 SDP 带着全部候选与两个视频段的编解码器列表，
 * 只有 STUN 时就已经约 11KB，加上 TURN 的中继候选会超过帧的上限；SDP 重复内容多，压缩后约剩四分之一
 */
async function pack(s: Signal): Promise<string> {
  const stream = new Blob([JSON.stringify(s)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

async function unpack(data: string): Promise<Signal> {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return JSON.parse(await new Response(stream).text()) as Signal
}

// ---------- 收尾 ----------

class CallError extends Error {}

/** 出错：结束本标签页的通话；还在进行的话通知服务端挂断 */
function fail(e: unknown) {
  const call = view.call
  const wasOwner = owner
  const code = e instanceof OpFailure ? e.code : null
  if (code === null) console.error(e)
  finish(null, errorText(e))
  if (call && wasOwner && code !== 'call_ended') void op('endCall', { chatId: call.chat_id, callId: call.call_id }).catch(() => {})
}

function errorText(e: unknown) {
  if (e instanceof CallError) return e.message
  if (e instanceof DOMException && e.name === 'NotAllowedError') return 'Microphone access was denied'
  if (!(e instanceof OpFailure)) return 'Call failed'
  switch (e.code) {
    case 'busy':
      return 'You’re already in a call'
    case 'blocked':
      return 'You can’t call this person'
    case 'offline':
      return 'You’re offline'
    case 'call_ended':
      return 'The call has ended'
    default:
      return 'Call failed'
  }
}

/** 结束本标签页的通话：释放媒体与连接，显示一会儿结果再收起 */
function finish(result: CallResult | null, error: string | null) {
  releaseLocal()
  owner = false
  set({ phase: 'ended', result, error, endedAt: Date.now(), minimized: false, camera: null, screen: null, remote: null })
  clearTimeout(lingerTimer)
  lingerTimer = setTimeout(reset, ENDED_LINGER_MS)
}

function reset() {
  releaseLocal()
  owner = false
  set(IDLE)
}

function releaseLocal() {
  stopTone()
  clearTimeout(connectTimer)
  clearTimeout(restartTimer)
  clearTimeout(lostTimer)
  lostTimer = undefined
  queued = []
  channel?.close()
  channel = null
  pc?.close()
  pc = null
  mic?.close()
  mic = null
  camera?.close()
  camera = null
  if (view.screen) stopStream(view.screen)
}

function stopTone() {
  tone?.stop()
  tone = null
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
}

/** 选定的麦克风（开着 AI 降噪时接上降噪）；换了麦克风时换掉发出去的音轨，不重新协商 */
async function getMic() {
  const opened = await openMicrophone({ follow: true })
  opened.onTrack = (track) => void sender('audio')?.replaceTrack(track)
  return opened
}
