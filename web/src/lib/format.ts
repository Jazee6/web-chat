import type { Presence } from 'shared/protocol'

const browser = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
/** 界面文案是英文，日期、地名也用英文：浏览器本身是英文时沿用它的地区习惯（如 en-GB 日在月前），否则用 en */
export const locale = browser.locale.startsWith('en') ? browser.locale : 'en'
// 12 / 24 小时制仍按浏览器
const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: browser.hourCycle })
const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' })
const shortDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
const longDate = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' })
const dayHeading = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' })
const segmenter = new Intl.Segmenter()

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(ts: number) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 消息分组标题里的时刻 */
export function formatTime(ts: number) {
  return time.format(ts)
}

/** 对话列表里的时间：今天显示时刻，昨天与消息列表的日期分隔条一样写 Yesterday，一周内显示星期，其余显示日期 */
export function formatDialogDate(ts: number, now = Date.now()) {
  const today = startOfDay(now)
  if (ts >= today) return time.format(ts)
  if (ts >= today - DAY_MS) return 'Yesterday'
  if (ts >= today - 6 * DAY_MS) return weekday.format(ts)
  if (new Date(ts).getFullYear() === new Date(now).getFullYear()) return shortDate.format(ts)
  return longDate.format(ts)
}

/** 消息列表的日期分隔条 */
export function formatDayHeading(ts: number, now = Date.now()) {
  const today = startOfDay(now)
  if (ts >= today) return 'Today'
  if (ts >= today - DAY_MS) return 'Yesterday'
  if (new Date(ts).getFullYear() === new Date(now).getFullYear()) return dayHeading.format(ts)
  return longDate.format(ts)
}

export function isSameDay(a: number, b: number) {
  return startOfDay(a) === startOfDay(b)
}

const MINUTE_MS = 60 * 1000

/** 相对时间：刚刚、几分钟前、今天 / 昨天的时刻，更早显示日期 */
function formatAgo(ts: number, now: number) {
  const ago = now - ts
  if (ago < MINUTE_MS) return 'just now'
  if (ago < 60 * MINUTE_MS) {
    const minutes = Math.floor(ago / MINUTE_MS)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  }
  const today = startOfDay(now)
  if (ts >= today) return `today at ${time.format(ts)}`
  if (ts >= today - DAY_MS) return `yesterday at ${time.format(ts)}`
  if (new Date(ts).getFullYear() === new Date(now).getFullYear()) return shortDate.format(ts)
  return longDate.format(ts)
}

/** 最后上线时间 */
export function formatLastSeen(ts: number, now = Date.now()) {
  if (ts <= 0) return 'last seen a long time ago'
  return `last seen ${formatAgo(ts, now)}`
}

/** 设备最后活跃时间；0 表示从未在前台 */
export function formatLastActive(ts: number, now = Date.now()) {
  if (ts <= 0) return 'Not active yet'
  return `Last active ${formatAgo(ts, now)}`
}

/** 日期：今年省略年份 */
export function formatDate(ts: number, now = Date.now()) {
  return new Date(ts).getFullYear() === new Date(now).getFullYear() ? shortDate.format(ts) : longDate.format(ts)
}

/** 标题栏里的在线状态；对方隐藏了最后上线时间时只有大致范围 */
export function formatPresence(presence: Presence, now = Date.now()) {
  switch (presence.status) {
    case 'online':
      return 'online'
    case 'offline':
      return formatLastSeen(presence.last_seen, now)
    case 'recently':
      return 'last seen recently'
    case 'week':
      return 'last seen within a week'
    case 'month':
      return 'last seen within a month'
    case 'long':
      return 'last seen a long time ago'
  }
}

/** 头像占位：按字素簇取名字首字，避免截断表情或合字 */
export function initials(name: string) {
  const first = segmenter.segment(name.trim())[Symbol.iterator]().next().value?.segment
  return (first ?? '?').toUpperCase()
}

const byteUnits = ['B', 'KB', 'MB', 'GB'] as const

/** 文件大小：1024 进制，保留一位小数 */
export function formatBytes(bytes: number) {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < byteUnits.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${byteUnits[unit]}`
}
