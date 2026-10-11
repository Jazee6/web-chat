// 本机的音视频设备列表：enumerateDevices 加 devicechange。没有授权时浏览器只给出没有名字的占位项，
// 这时视为还没授权（access 为 false），列表为空
import { useEffect, useSyncExternalStore } from 'react'

import { avPreferences, onAvPreferences, setAvPreference, useAvPreferences, type AvKind } from './preferences'

export type AvDevice = { id: string; label: string; groupId: string }

export type AvDeviceList = {
  devices: Record<AvKind, AvDevice[]>
  /** 系统默认的那一个：只有 Chromium 的麦克风与扬声器列出 default 项，其他情况为 null */
  defaults: Record<AvKind, AvDevice | null>
  /** 已经授权、看得到设备名字 */
  access: { mic: boolean; camera: boolean }
  /** 已经读过一次 */
  loaded: boolean
}

const KINDS: Record<MediaDeviceKind, AvKind> = { audioinput: 'mic', audiooutput: 'speaker', videoinput: 'camera' }
/** Chromium 的两个虚拟项：系统默认与 Windows 的通信设备，不是实际的设备 */
const VIRTUAL = new Set(['default', 'communications'])

const EMPTY: AvDeviceList = {
  devices: { mic: [], speaker: [], camera: [] },
  defaults: { mic: null, speaker: null, camera: null },
  access: { mic: false, camera: false },
  loaded: false,
}

export const avDevicesSupported = typeof navigator.mediaDevices?.enumerateDevices === 'function'
/** 能选扬声器（iOS Safari 不能） */
export const speakerSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype

let list = EMPTY
/** 上一次读到的列表的指纹：没变时不通知（每次取到媒体后都会重读一遍） */
let signature = ''
const listeners = new Set<() => void>()
let watching = false

/** 重新读一遍设备列表（授权之后名字才拿得到，取到媒体后调用一次） */
export async function refreshAvDevices(): Promise<AvDeviceList> {
  if (!avDevicesSupported) return list
  const infos = await navigator.mediaDevices.enumerateDevices().catch(() => [])
  const next: AvDeviceList = {
    devices: { mic: [], speaker: [], camera: [] },
    defaults: { mic: null, speaker: null, camera: null },
    access: { mic: false, camera: false },
    loaded: true,
  }
  for (const info of infos) {
    const kind = KINDS[info.kind]
    if (!info.label || !info.deviceId) continue
    const device = { id: info.deviceId, label: info.label, groupId: info.groupId }
    if (info.deviceId === 'default') next.defaults[kind] = device
    if (VIRTUAL.has(info.deviceId)) continue
    next.devices[kind].push(device)
  }
  next.access = { mic: next.devices.mic.length > 0, camera: next.devices.camera.length > 0 }
  const sig = JSON.stringify(infos.map((i) => [i.kind, i.deviceId, i.groupId, i.label]))
  if (list.loaded && sig === signature) return list
  signature = sig
  list = next
  for (const listener of listeners) listener()
  return next
}

/** 订阅设备列表的变化（插拔设备、授权后拿到名字） */
export function onAvDevices(listener: () => void): () => void {
  listeners.add(listener)
  if (!watching && avDevicesSupported) {
    watching = true
    navigator.mediaDevices.addEventListener('devicechange', () => void refreshAvDevices())
    void refreshAvDevices()
  }
  return () => listeners.delete(listener)
}

export function avDevices(): AvDeviceList {
  return list
}

export function useAvDevices(): AvDeviceList {
  return useSyncExternalStore(onAvDevices, avDevices)
}

/** 列表里"跟随系统"那一项的值 */
export const SYSTEM_DEFAULT = 'default'

/** "跟随系统"的名字，知道系统默认是哪个时带上它的名字（Chromium 的 default 项名为本地化的 "Default - 名字"） */
export function systemDefaultLabel(list: AvDeviceList, kind: AvKind): string {
  const device = list.defaults[kind]
  return device ? `System default (${device.label.replace(/^.+? - /, '')})` : 'System default'
}

/** 列表里选中的值：选定的设备不在时显示为跟随系统（实际用的就是系统默认） */
export function selectedValue(list: AvDeviceList, kind: AvKind, chosen: string | null): string {
  return list.devices[kind].some((d) => d.id === chosen) ? chosen! : SYSTEM_DEFAULT
}

/** 从列表里选了一项 */
export function choose(kind: AvKind, value: string) {
  setAvPreference({ [kind]: value === SYSTEM_DEFAULT ? null : value })
}

/** 后置摄像头拍的不用镜像 */
export function isMirrored(stream: MediaStream): boolean {
  return stream.getVideoTracks()[0]?.getSettings().facingMode !== 'environment'
}

/**
 * 现在应该用的设备：选定的那个在就用它，否则用系统默认。不知道系统默认是哪个时为 null，
 * 这时不跟着换（摄像头没有系统默认；手机上列表里的第一个可能是后置摄像头）
 */
export function wantedDevice(kind: AvKind): AvDevice | null {
  const chosen = avPreferences()[kind]
  return list.devices[kind].find((d) => d.id === chosen) ?? list.defaults[kind]
}

/** 一个目标设备的标识；系统换了默认设备时 default 项的 groupId 变，标识也跟着变 */
export const deviceKey = (device: AvDevice) => `${device.id}:${device.groupId}`

/** 这个标识的设备还在列表里（拔掉后为 false，插回来时要重新为它换） */
export function deviceKeyPresent(kind: AvKind, key: string): boolean {
  const defaults = list.defaults[kind]
  return list.devices[kind].some((d) => deviceKey(d) === key) || (defaults !== null && deviceKey(defaults) === key)
}

/**
 * 轨道是不是取自这个设备。系统默认（Chromium 的 default 项）的 deviceId 不是实际设备的，
 * 所以声音按 groupId 比：系统切换了默认设备时 default 项的 groupId 跟着变
 */
export function trackIsOn(track: MediaStreamTrack, device: AvDevice): boolean {
  const settings = track.getSettings()
  if (settings.deviceId === device.id) return true
  return track.kind === 'audio' && !!settings.groupId && settings.groupId === device.groupId
}

/** 取媒体时的 deviceId 约束：选定的设备不在时浏览器退回系统默认 */
export function deviceConstraint(kind: AvKind): ConstrainDOMString | undefined {
  const chosen = avPreferences()[kind]
  return chosen ? { ideal: chosen } : undefined
}

/** 请求麦克风或摄像头的权限，拿到后马上放掉，只为看得到设备名字 */
export async function requestAvAccess(kind: 'mic' | 'camera'): Promise<'granted' | 'denied' | 'unavailable'> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'mic' ? { audio: true } : { video: true })
    for (const track of stream.getTracks()) track.stop()
    await refreshAvDevices()
    return 'granted'
  } catch (e) {
    return e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'unavailable'
  }
}

type Sink = { setSinkId(id: string): Promise<void> }

/** 让元素或 AudioContext 的声音从选定的扬声器出来；选定的不在时用系统默认。不支持的浏览器什么都不做 */
export async function applySpeaker(target: Sink | object): Promise<void> {
  if (!('setSinkId' in target)) return
  const sink = target as Sink
  const chosen = avPreferences().speaker ?? ''
  await sink.setSinkId(chosen).catch(() => sink.setSinkId('').catch(() => {}))
}

/** 元素的声音跟着选定的扬声器：换了选择、选定的扬声器插回来时重新设置 */
export function useSpeakerOutput(ref: React.RefObject<HTMLMediaElement | null>) {
  const speaker = useAvPreferences().speaker
  const devices = useAvDevices()
  useEffect(() => {
    if (ref.current) void applySpeaker(ref.current)
  }, [ref, speaker, devices])
}

/** 不在 React 里的元素（语音消息的全局播放器）：跟着选定的扬声器，返回取消订阅 */
export function followSpeaker(el: HTMLMediaElement): () => void {
  void applySpeaker(el)
  const apply = () => void applySpeaker(el)
  const offPreferences = onAvPreferences(apply)
  const offDevices = onAvDevices(apply)
  return () => {
    offPreferences()
    offDevices()
  }
}
