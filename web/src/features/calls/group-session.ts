// 群组通话的标签页侧：加入的标签页持有到 SFU 的 RTCPeerConnection，按房间状态拉取别人的媒体、发布自己的。
// SFU 的每次变更都经服务端（App Secret 不出服务端），一次只做一个，SDP 交换做完再做下一个。
// 见 docs/architecture/07-client.md § 群组通话、docs/adr/0009
import { useEffect, useSyncExternalStore } from 'react'
import { GROUP_CALL_LOCK, randomToken, type CallSlot, type GroupCall, type IceServer, type SimulcastRid } from 'shared/protocol'

import { toast } from '@/components/ui/toast'
import { openCamera, type Camera } from '@/features/av/camera'
import { openMicrophone, type Microphone } from '@/features/av/microphone'
import { inPip } from '@/features/pip/pip'
import { blockReload } from '@/lib/reload'
import { call as op, onGroupCall, OpFailure } from '@/sync/client'
import { repairSdp } from './sdp'

/** joining：正在加入；active：在通话里 */
type GroupPhase = 'idle' | 'joining' | 'active'

/** 一个人的媒体，每路一个流；没在发或还没拉到的没有 */
type PeerStreams = Partial<Record<CallSlot, MediaStream>>

/** 放大的画面：某人的摄像头或屏幕 */
export type Focus = { userId: string; slot: 'camera' | 'screen' }

export type GroupView = {
  phase: GroupPhase
  chatId: string | null
  call: GroupCall | null
  /** 开着麦克风 */
  mic: boolean
  camera: MediaStream | null
  screen: MediaStream | null
  /** 别人的媒体，按 user_id */
  remote: Record<string, PeerStreams>
  /** 正在说话的人（含自己） */
  speaking: string[]
  /** 用户点选放大的画面；没点选时自动放大第一个共享屏幕的 */
  pinned: Focus | null
  minimized: boolean
}

const IDLE: GroupView = {
  phase: 'idle',
  chatId: null,
  call: null,
  mic: false,
  camera: null,
  screen: null,
  remote: {},
  speaking: [],
  pinned: null,
  minimized: false,
}

/** 摄像头发三层（simulcast）：宫格拉 h，放大的拉 f，放大时其余小窗拉 q */
const CAMERA_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: 'f', maxBitrate: 1_200_000 },
  { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 500_000 },
  { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 150_000 },
]
/** 多久测一次各路音量；超过阈值算在说话 */
const SPEAKING_POLL_MS = 400
const SPEAKING_LEVEL = 0.02
/** 连接断了以后自动重新加入的次数 */
const MAX_REJOINS = 3

let view: GroupView = IDLE
const listeners = new Set<() => void>()
// 通话中不重载页面（发布了新版本时）
blockReload(() => view.phase !== 'idle')

function set(patch: Partial<GroupView>) {
  view = { ...view, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useGroupCall(): GroupView {
  return useSyncExternalStore(subscribe, () => view)
}

/** 实际放大的画面：点选的还在就用它，否则第一个共享屏幕的别人 */
export function focusOf(v: GroupView): Focus | null {
  const call = v.call
  if (!call) return null
  const has = (f: Focus) => call.participants.some((p) => p.user_id === f.userId && p.tracks[f.slot] !== undefined)
  if (v.pinned && has(v.pinned)) return v.pinned
  const sharing = call.participants.find((p) => p.user_id !== me && p.tracks.screen)
  return sharing ? { userId: sharing.user_id, slot: 'screen' } : null
}

// ---------- 各群组的通话（横条） ----------

/** 横条的高度（h-12），会话的消息列表据此让出位置 */
export const GROUP_CALL_BANNER_HEIGHT = 48

const known = new Map<string, { call: GroupCall | null; mine: boolean }>()
const knownListeners = new Set<() => void>()

function setKnown(chatId: string, call: GroupCall | null, mine: boolean) {
  known.set(chatId, { call, mine })
  for (const listener of knownListeners) listener()
}

/** 群组里进行中的通话（横条用）：先问同步 Worker 记得的，之后跟着事件更新 */
export function useGroupCallOf(chatId: string): GroupCall | null {
  useEffect(() => {
    if (known.has(chatId)) return
    op('groupCallOf', { chatId })
      .then(({ call, mine }) => {
        if (!known.has(chatId)) setKnown(chatId, call, mine)
      })
      .catch(() => {})
  }, [chatId])
  return useSyncExternalStore(
    (listener) => {
      knownListeners.add(listener)
      return () => knownListeners.delete(listener)
    },
    () => known.get(chatId)?.call ?? null,
  )
}

// ---------- 本标签页的连接 ----------

let me = ''
let pc: RTCPeerConnection | null = null
let iceServers: IceServer[] = []
let mic: Microphone | null = null
let camera: Camera | null = null
/** 本端发布着的收发器 */
let sending: Partial<Record<CallSlot, RTCRtpTransceiver>> = {}
/** 拉取着的：SFU 上的 track 名 → 谁的哪路、本端的 mid、摄像头拉的层 */
let pulls = new Map<string, { userId: string; slot: CallSlot; mid: string; rid?: SimulcastRid }>()
/** SFU 操作排成一队，一次只做一个 */
let queue: Promise<unknown> = Promise.resolve()
let reconcileQueued = false
let speakingTimer: ReturnType<typeof setInterval> | undefined
let rejoins = 0
/** 在通话里时持有的 Web Lock；同步 Worker 排队等它，拿到即说明这个标签页没了（崩溃、被杀），替它离开 */
let releaseLock: (() => void) | null = null

/** 拿锁：同一台设备上另一个标签页在通话里时拿不到（同步 Worker 替关掉的标签页离开时会短暂占用，稍等再试一次） */
async function holdLock(): Promise<boolean> {
  for (const wait of [0, 500]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    const held = await new Promise<boolean>((resolve) => {
      void navigator.locks.request(GROUP_CALL_LOCK, { ifAvailable: true }, (lock) => {
        resolve(lock !== null)
        return lock ? new Promise<void>((release) => (releaseLock = release)) : undefined
      })
    })
    if (held) return true
  }
  return false
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  queue = run.catch(() => {})
  return run
}

/** 只在顶层窗口里接通话；画中画里的页面不参与 */
export function startGroupCalls(userId: string) {
  if (inPip || me) return
  me = userId
  onGroupCall(onGroupCallEvent)
  // 关掉标签页时尽量离开；没送出去的由服务端在设备断线期满后移出
  addEventListener('pagehide', () => {
    if (view.phase !== 'idle' && view.call) void op('leaveGroupCall', { chatId: view.call.chat_id, callId: view.call.call_id })
  })
}

function onGroupCallEvent(chatId: string, call: GroupCall | null, mine: boolean) {
  setKnown(chatId, call, mine)
  if (view.phase !== 'active' || view.chatId !== chatId) return
  if (!call || call.call_id !== view.call?.call_id) return finish('The call has ended')
  if (!call.participants.some((p) => p.user_id === me)) return finish('You’re no longer in the call')
  if (!mine) return finish('You joined the call on another device')
  set({ call })
  scheduleReconcile()
}

/** 自己在这个群组的通话里（本标签页） */
export function inGroupCall(chatId: string) {
  return view.phase !== 'idle' && view.chatId === chatId
}

// ---------- 加入、离开 ----------

/**
 * 加入群组里进行中的通话，没有时发起；必须在用户操作里调用（发起时要取麦克风）。
 * 发起者开着麦克风，加入的人静音：第一次开麦时才取麦克风并发布
 */
export async function joinGroupCall(chatId: string): Promise<void> {
  if (view.phase !== 'idle') return
  // 记得的通话可能已经结束（结束的通知丢了）：总用新的 ID，有进行中的服务端照样加入它；是不是发起者以服务端为准
  const starting = (known.get(chatId)?.call ?? null) === null
  set({ ...IDLE, phase: 'joining', chatId })
  rejoins = 0
  /** 等待期间可能已经离开 */
  const pending = () => view.phase === 'joining' && view.chatId === chatId
  try {
    if (!(await holdLock())) throw new CallError('You’re in a call in another tab')
    // 发起时在用户操作里先取麦克风（要授权）
    let opened = starting ? await getMic() : null
    if (!pending()) {
      opened?.close()
      return
    }
    const res = await op('joinGroupCall', { chatId, callId: randomToken() })
    if (!pending()) {
      opened?.close()
      void op('leaveGroupCall', { chatId, callId: res.call.call_id }).catch(() => {})
      return
    }
    // 服务端说我开着麦（我是发起者）就发布麦克风，说静音（别人先发起了）就放掉
    const unmuted = res.call.participants.find((p) => p.user_id === me)?.muted === false
    if (unmuted && !opened) opened = await getMic()
    if (!unmuted && opened) {
      opened.close()
      opened = null
    }
    if (!pending()) {
      opened?.close()
      return
    }
    mic = opened
    iceServers = res.iceServers
    createConnection()
    set({ phase: 'active', call: res.call, mic: mic !== null })
    if (mic) await enqueue(() => publish('mic', mic!.track))
    scheduleReconcile()
    speakingTimer = setInterval(() => void pollSpeaking(), SPEAKING_POLL_MS)
  } catch (e) {
    fail(e)
  }
}

export async function leaveGroupCall(): Promise<void> {
  const call = view.call
  const chatId = view.chatId
  release()
  set(IDLE)
  if (!call || !chatId) return
  try {
    await op('leaveGroupCall', { chatId, callId: call.call_id })
  } catch {
    // 离线：服务端在设备断线期满后移出
  }
}

export function setGroupMinimized(minimized: boolean) {
  set({ minimized })
}

/** 点选放大的画面；再点一次取消 */
export function togglePinned(focus: Focus) {
  const cur = focusOf(view)
  set({ pinned: cur && cur.userId === focus.userId && cur.slot === focus.slot ? null : focus })
  scheduleReconcile()
}

// ---------- 媒体开关 ----------

export async function toggleGroupMic() {
  const call = view.call
  if (view.phase !== 'active' || !call) return
  if (!mic) {
    // 第一次开麦：取麦克风并发布（服务端随之记为开麦）
    try {
      mic = await getMic()
      set({ mic: true })
      await enqueue(() => publish('mic', mic!.track))
    } catch (e) {
      mic?.close()
      mic = null
      set({ mic: false })
      report(e, "Couldn't turn on the microphone")
    }
    return
  }
  // 之后静音只是不出声，track 照旧发着（SFU 会回收 30 秒没有数据的 track）
  const on = !view.mic
  mic.enabled = on
  set({ mic: on })
  op('muteGroupCall', { chatId: call.chat_id, callId: call.call_id, muted: !on }).catch(() => {})
}

export async function toggleGroupCamera() {
  if (view.phase !== 'active') return
  if (camera) {
    const cur = camera
    camera = null
    set({ camera: null })
    cur.close()
    await enqueue(() => unpublish('camera')).catch((e: unknown) => report(e, "Couldn't turn off the camera"))
    return
  }
  try {
    const opened = await openCamera()
    // 等授权期间离开了
    if (view.phase !== 'active') return opened.close()
    camera = opened
    // 换了摄像头（选了别的、前后翻转、插拔）：换轨道，不重新协商
    opened.onStream = (stream) => {
      set({ camera: stream })
      void enqueue(async () => {
        await sending.camera?.sender.replaceTrack(stream.getVideoTracks()[0]!)
      }).catch((e: unknown) => console.warn("couldn't switch the camera", e))
    }
    set({ camera: opened.stream })
    await enqueue(() => publish('camera', opened.track, CAMERA_ENCODINGS))
  } catch (e) {
    camera?.close()
    camera = null
    set({ camera: null })
    report(e, "Couldn't turn on the camera")
  }
}

/** 前后摄像头互换（手机） */
export function flipGroupCamera() {
  camera?.flip()
}

export async function toggleGroupScreen() {
  if (view.phase !== 'active') return
  if (view.screen) return stopScreen()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  } catch {
    return // 用户取消了选择
  }
  const track = stream.getVideoTracks()[0]!
  track.contentHint = 'detail'
  // 用户在浏览器自带的"停止共享"里结束
  track.addEventListener('ended', () => void stopScreen())
  set({ screen: stream })
  await enqueue(() => publish('screen', track)).catch((e: unknown) => {
    stopStream(stream)
    set({ screen: null })
    report(e, "Couldn't share the screen")
  })
}

async function stopScreen() {
  const stream = view.screen
  if (!stream) return
  set({ screen: null })
  stopStream(stream)
  await enqueue(() => unpublish('screen')).catch((e: unknown) => report(e, "Couldn't stop sharing"))
}

// ---------- SFU ----------

function createConnection() {
  const conn = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
  pc = conn
  conn.ontrack = (e) => {
    const pull = [...pulls.values()].find((p) => p.mid === e.transceiver.mid)
    if (!pull) return
    setRemote(pull.userId, pull.slot, new MediaStream([e.track]))
  }
  conn.onconnectionstatechange = () => {
    if (conn !== pc || conn.connectionState !== 'failed') return
    // 网络切换之类：换一个新的 SFU session 重新加入
    if (rejoins >= MAX_REJOINS) return fail(new Error('Connection lost'))
    rejoins++
    void enqueue(rejoin).catch(fail)
  }
}

/** 连接坏了：同一台设备重新加入，服务端换掉 SFU session，然后重新发布、重新拉取 */
async function rejoin() {
  const call = view.call
  if (view.phase !== 'active' || !call) return
  pc?.close()
  sending = {}
  pulls = new Map()
  set({ remote: {} })
  const res = await op('joinGroupCall', { chatId: call.chat_id, callId: call.call_id })
  iceServers = res.iceServers
  createConnection()
  set({ call: res.call })
  if (mic) {
    await publish('mic', mic.track)
    if (!view.mic) await op('muteGroupCall', { chatId: call.chat_id, callId: call.call_id, muted: true })
  }
  if (view.camera) await publish('camera', view.camera.getVideoTracks()[0]!, CAMERA_ENCODINGS)
  if (view.screen) await publish('screen', view.screen.getVideoTracks()[0]!)
  scheduleReconcile()
}

async function publish(slot: CallSlot, track: MediaStreamTrack, sendEncodings?: RTCRtpEncodingParameters[]) {
  const conn = pc!
  const call = view.call!
  const t = conn.addTransceiver(track, { direction: 'sendonly', ...(sendEncodings ? { sendEncodings } : {}) })
  try {
    await conn.setLocalDescription(await conn.createOffer())
    const sdp = await op('publishGroupCall', {
      chatId: call.chat_id,
      callId: call.call_id,
      sdp: await pack(conn.localDescription!.sdp),
      tracks: [{ mid: t.mid!, slot }],
    })
    await conn.setRemoteDescription({ type: 'answer', sdp: repairSdp(sdp) })
    sending[slot] = t
  } catch (e) {
    if (conn.signalingState === 'have-local-offer') await conn.setLocalDescription({ type: 'rollback' }).catch(() => {})
    t.stop()
    throw e
  }
}

async function unpublish(slot: CallSlot) {
  const conn = pc
  const call = view.call
  const t = sending[slot]
  if (!conn || !call || !t) return
  delete sending[slot]
  t.stop()
  await conn.setLocalDescription(await conn.createOffer())
  const sdp = await op('unpublishGroupCall', { chatId: call.chat_id, callId: call.call_id, sdp: await pack(conn.localDescription!.sdp), slots: [slot] })
  await conn.setRemoteDescription({ type: 'answer', sdp: repairSdp(sdp) })
}

function scheduleReconcile() {
  if (reconcileQueued) return
  reconcileQueued = true
  void enqueue(async () => {
    reconcileQueued = false
    await reconcile()
  }).catch((e: unknown) => {
    if (e instanceof OpFailure && e.code === 'call_ended') return finish('The call has ended')
    console.warn('group call reconcile failed', e)
  })
}

/** 摄像头拉哪一层：放大的拉 f；有放大的画面时其余拉 q，否则拉 h */
function ridFor(userId: string): SimulcastRid {
  const focus = focusOf(view)
  if (!focus) return 'h'
  return focus.userId === userId && focus.slot === 'camera' ? 'f' : 'q'
}

/** 让拉取的媒体与房间状态一致：拉新发布的，忘掉不再发的（SFU 已经不转发了），换摄像头的层 */
async function reconcile() {
  const conn = pc
  const call = view.call
  if (view.phase !== 'active' || !conn || !call) return
  const wanted = call.participants.flatMap((p) =>
    p.user_id === me
      ? []
      : (['mic', 'camera', 'screen'] as const).flatMap((slot) => {
          const name = p.tracks[slot]
          return name ? [{ user_id: p.user_id, slot, name, ...(slot === 'camera' ? { rid: ridFor(p.user_id) } : {}) }] : []
        }),
  )
  const names = new Set(wanted.map((w) => w.name))
  for (const [name, pull] of pulls) {
    if (names.has(name)) continue
    pulls.delete(name)
    setRemote(pull.userId, pull.slot, null)
  }

  const fresh = wanted.filter((w) => !pulls.has(w.name))
  if (fresh.length > 0) {
    const res = await op('pullGroupCall', {
      chatId: call.chat_id,
      callId: call.call_id,
      tracks: fresh.map(({ user_id, slot, rid }) => ({ user_id, slot, ...(rid ? { rid } : {}) })),
    })
    for (const t of res.tracks) {
      if (!('mid' in t)) continue
      const rid = fresh.find((f) => f.user_id === t.user_id && f.slot === t.slot)?.rid
      pulls.set(t.track, { userId: t.user_id, slot: t.slot, mid: t.mid, ...(rid ? { rid } : {}) })
    }
    if (res.sdp) {
      await conn.setRemoteDescription({ type: 'offer', sdp: repairSdp(res.sdp) })
      await conn.setLocalDescription(await conn.createAnswer())
      await op('answerGroupCall', { chatId: call.chat_id, callId: call.call_id, sdp: await pack(conn.localDescription!.sdp) })
    }
  }

  for (const pull of pulls.values()) {
    if (pull.slot !== 'camera') continue
    const rid = ridFor(pull.userId)
    if (pull.rid === rid) continue
    await op('layerGroupCall', { chatId: call.chat_id, callId: call.call_id, mid: pull.mid, userId: pull.userId, rid })
    pull.rid = rid
  }
}

function setRemote(userId: string, slot: CallSlot, stream: MediaStream | null) {
  const { [slot]: _, ...rest } = view.remote[userId] ?? {}
  const next: PeerStreams = stream ? { ...rest, [slot]: stream } : rest
  set({ remote: { ...view.remote, [userId]: next } })
}

/** 各路声音的音量：别人的取接收端统计，自己的取麦克风源 */
async function pollSpeaking() {
  const conn = pc
  if (!conn || view.phase !== 'active') return
  const stats = await conn.getStats().catch(() => null)
  if (!stats) return
  const speaking = new Set<string>()
  stats.forEach((r: { type: string; kind?: string; mid?: string; audioLevel?: number }) => {
    if (r.kind !== 'audio' || (r.audioLevel ?? 0) < SPEAKING_LEVEL) return
    if (r.type === 'inbound-rtp') {
      const pull = [...pulls.values()].find((p) => p.mid === r.mid)
      if (pull) speaking.add(pull.userId)
    } else if (r.type === 'media-source' && view.mic) {
      speaking.add(me)
    }
  })
  const muted = new Set(view.call?.participants.filter((p) => p.muted).map((p) => p.user_id))
  const next = [...speaking].filter((id) => id === me || !muted.has(id)).sort()
  if (next.join() !== view.speaking.join()) set({ speaking: next })
}

/** SDP 压缩后再发：一个人拉的路数多了，SDP 会超过帧的上限；内容重复多，压缩后剩很少 */
async function pack(sdp: string): Promise<string> {
  const stream = new Blob([sdp]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// ---------- 收尾 ----------

class CallError extends Error {}

/** 出错：离开通话，提示原因 */
function fail(e: unknown) {
  const call = view.call
  const chatId = view.chatId
  const code = e instanceof OpFailure ? e.code : null
  if (code === null) console.error(e)
  finish(errorText(e))
  if (call && chatId && code !== 'call_ended') void op('leaveGroupCall', { chatId, callId: call.call_id }).catch(() => {})
}

function report(e: unknown, title: string) {
  if (e instanceof OpFailure && e.code === 'call_ended') return finish('The call has ended')
  console.warn(title, e)
  toast.add({ type: 'error', title, description: e instanceof DOMException && e.name === 'NotAllowedError' ? 'Permission was denied.' : undefined })
}

function errorText(e: unknown) {
  if (e instanceof CallError) return e.message
  if (e instanceof DOMException && e.name === 'NotAllowedError') return 'Microphone access was denied'
  if (!(e instanceof OpFailure)) return 'Call failed'
  switch (e.code) {
    case 'busy':
      return 'You’re already in a call'
    case 'offline':
      return 'You’re offline'
    case 'call_ended':
      return 'The call has ended'
    case 'forbidden':
      return 'You’re not a member of this group'
    default:
      return 'Call failed'
  }
}

/** 结束本标签页的通话；reason 显示成提示 */
function finish(reason: string | null) {
  release()
  set(IDLE)
  if (reason) toast.add({ type: 'info', title: reason })
}

function release() {
  releaseLock?.()
  releaseLock = null
  clearInterval(speakingTimer)
  pc?.close()
  pc = null
  sending = {}
  pulls = new Map()
  queue = Promise.resolve()
  reconcileQueued = false
  mic?.close()
  mic = null
  camera?.close()
  camera = null
  if (view.screen) stopStream(view.screen)
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop()
}

/** 选定的麦克风（开着 AI 降噪时接上降噪）；换了麦克风时换掉发布着的音轨，不重新协商 */
async function getMic() {
  const opened = await openMicrophone({ follow: true })
  opened.onTrack = (track) => {
    void enqueue(async () => {
      await sending.mic?.sender.replaceTrack(track)
    }).catch((e: unknown) => console.warn("couldn't switch the microphone", e))
  }
  return opened
}
