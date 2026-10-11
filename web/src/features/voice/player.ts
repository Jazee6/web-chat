// 语音消息的播放器：每个页面（画中画小窗是独立的页面）一个全局的 <audio>，离开会话照常播放，由播放条控制。
// 见 CONTEXT.md「播放条」与 docs/architecture/05-media.md § 语音消息
import { useSyncExternalStore } from 'react'
import type { SealedMedia, Voice } from 'shared/protocol'

import { followSpeaker } from '@/features/av/devices'
import { mediaUrl } from '@/features/media/media-url'
import { openSealed } from '@/features/secret/sealed-media'
import { call } from '@/sync/client'
import { NEXT_UNPLAYED_SQL } from './unplayed'

/** 正在播放的语音消息；秘密聊天的录音是加密的，带着密钥与格式 */
export type Track = {
  chatId: string
  seq: number
  senderId: string
  key: string
  duration: number
  sealed?: { secret: string; mime: string }
}

/** 一条语音消息的曲目 */
export function voiceTrack(chatId: string, seq: number, senderId: string, voice: Voice | Extract<SealedMedia, { type: 'voice' }>): Track {
  const sealed = 'secret' in voice ? { sealed: { secret: voice.secret, mime: voice.mime } } : {}
  return { chatId, seq, senderId, key: voice.key, duration: voice.duration, ...sealed }
}

export type PlayerState = {
  track: Track | null
  playing: boolean
  /** 录音还没取回 */
  loading: boolean
  /** 已播放的秒数 */
  position: number
  rate: Rate
}

export const RATES = [1, 1.5, 2] as const
export type Rate = (typeof RATES)[number]

const RATE_KEY = 'voice-rate'
/** 取回的录音留几个在内存里（object URL），来回切换不必重新读缓存 */
const KEEP_URLS = 4
/** 几个标签页（含画中画小窗）之间同一时间只播一条 */
const CHANNEL = 'web-chat-voice'
/** 50ms 的静音 WAV（有实际的样本，零样本的文件可能不算播放过）：在用户点击里先播一下，之后连播的 play() 不会被自动播放策略拦下（iOS Safari） */
const SILENCE = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'

function savedRate(): Rate {
  try {
    const n = Number(localStorage.getItem(RATE_KEY))
    return (RATES as readonly number[]).includes(n) ? (n as Rate) : 1
  } catch {
    return 1
  }
}

let state: PlayerState = { track: null, playing: false, loading: false, position: 0, rate: savedRate() }
const listeners = new Set<() => void>()
const urls = new Map<string, string>()
const instance = crypto.randomUUID()
let audio: HTMLAudioElement | null = null
let channel: BroadcastChannel | null = null
let me = ''
/** 每次换曲目递增：取回录音期间又换了曲目时，旧的不再播放 */
let generation = 0

function set(patch: Partial<PlayerState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function element() {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'auto'
  // 页面一直开着，不取消
  followSpeaker(audio)
  // 解锁用的静音片段的事件都不算
  const real = () => audio!.src !== SILENCE && !state.loading
  audio.addEventListener('timeupdate', () => {
    if (state.track && real()) set({ position: Math.min(audio!.currentTime, state.track.duration) })
  })
  audio.addEventListener('play', () => real() && set({ playing: true }))
  audio.addEventListener('pause', () => real() && set({ playing: false }))
  audio.addEventListener('ended', () => real() && void next())
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (e: MessageEvent<string>) => {
    if (e.data !== instance) pause()
  }
  return audio
}

/** 取回录音（经 Service Worker 缓存；秘密聊天的取回后解开），返回 object URL */
async function load({ key, sealed }: Track): Promise<string> {
  const cached = urls.get(key)
  if (cached) return cached
  let blob: Blob
  if (sealed) {
    blob = await openSealed({ key, secret: sealed.secret, role: 'main', type: sealed.mime })
  } else {
    const res = await fetch(mediaUrl(key), { mode: 'cors', referrerPolicy: 'no-referrer' })
    if (!res.ok) throw new Error(`voice fetch failed: ${res.status}`)
    blob = await res.blob()
  }
  const url = URL.createObjectURL(blob)
  urls.set(key, url)
  for (const [k, u] of urls) {
    if (urls.size <= KEEP_URLS) break
    if (k === state.track?.key) continue
    URL.revokeObjectURL(u)
    urls.delete(k)
  }
  return url
}

/**
 * 从头播放一条语音消息，记为已听（只记别人发来的）。必须在用户操作中调用（连播除外），
 * 取回录音之前先在这次操作里解锁 <audio>
 */
export async function play(track: Track, meId: string) {
  const el = element()
  me = meId
  const gen = ++generation
  if (!el.src || el.src === SILENCE) {
    el.src = SILENCE
    el.play().catch(() => {})
  } else {
    el.pause()
  }
  channel!.postMessage(instance)
  set({ track, loading: true, position: 0, playing: false })
  if (track.senderId !== meId) void call('markPlayed', { chatId: track.chatId, seq: track.seq }).catch(() => {})
  try {
    const url = await load(track)
    if (gen !== generation) return
    el.src = url
    el.playbackRate = state.rate
    set({ loading: false })
    await el.play()
  } catch (e) {
    if (gen !== generation) return
    close()
    throw e
  }
}

/** 播完一条：接着播同一会话里后面的未听语音，没有了就收起 */
async function next() {
  const track = state.track
  if (!track) return
  const gen = generation
  const [row] = await call('query', { sql: NEXT_UNPLAYED_SQL, params: [track.chatId, track.seq, me] }).catch(() => [])
  if (gen !== generation) return
  const voice = row ? (JSON.parse(row.media as string) as Voice[])[0] : undefined
  if (!row || !voice) {
    close()
    return
  }
  play(voiceTrack(track.chatId, Number(row.seq), String(row.sender_id), voice), me).catch(() => {})
}

function resume() {
  if (!audio || !state.track || state.loading) return
  channel!.postMessage(instance)
  audio.play().catch(() => {})
}

export function pause() {
  audio?.pause()
}

export function toggle() {
  if (state.playing) pause()
  else resume()
}

export function seek(seconds: number) {
  if (!audio || !state.track || state.loading) return
  audio.currentTime = Math.max(0, Math.min(seconds, state.track.duration))
  set({ position: audio.currentTime })
}

export function setRate(rate: Rate) {
  if (audio) audio.playbackRate = rate
  try {
    localStorage.setItem(RATE_KEY, String(rate))
  } catch {
    // 只是本机偏好，存不下也无妨
  }
  set({ rate })
}

/** 停止并收起播放条 */
export function close() {
  generation++
  audio?.pause()
  set({ track: null, playing: false, loading: false, position: 0 })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(subscribe, () => state)
}

/** 这条消息是不是正在播放器里（播放中或暂停着） */
export function isCurrent(s: PlayerState, chatId: string, seq: number | null) {
  return s.track !== null && s.track.chatId === chatId && s.track.seq === seq
}

/** 播放进度条朗读的值：秒数（滑块的值以秒为单位） */
export const POSITION_FORMAT: Intl.NumberFormatOptions = { style: 'unit', unit: 'second', unitDisplay: 'long', maximumFractionDigits: 0 }
