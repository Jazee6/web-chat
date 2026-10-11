// 消息的文字摘要：对话列表、回复引用、消息列表与推送通知共用。文案为英文硬编码
import { isMissedCall, type CallResult, type MediaSummary, type PinExcerpt, type ServiceAction } from '../protocol'

export * from './links'

/** 服务消息里引用的消息摘要最多显示多少个字符 */
const EXCERPT_LENGTH = 40

/** 媒体消息的文字摘要 */
export function describeMedia(media: MediaSummary) {
  switch (media.kind) {
    case 'file':
      return media.name
    case 'voice':
      return `Voice message (${formatDuration(media.duration)})`
    case 'sticker':
      return 'Sticker'
    case 'album': {
      const videos = media.videos ?? 0
      const photos = media.count - videos
      if (videos === 0) return photos === 1 ? 'Photo' : `${photos} photos`
      if (photos > 0) return `${photos === 1 ? '1 photo' : `${photos} photos`}, ${videos === 1 ? '1 video' : `${videos} videos`}`
      return videos === 1 ? `Video (${formatDuration(media.duration ?? 0)})` : `${videos} videos`
    }
  }
}

/** 时长（秒）：m:ss */
export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 被置顶消息的摘要：文本过长时截断 */
export function describeExcerpt(excerpt: PinExcerpt) {
  if (excerpt.kind !== 'text') return describeMedia(excerpt)
  const text = excerpt.text.replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text
}

/** 撤回占位的文案 */
export function describeRecall(senderId: string, meId: string, users: Map<string, { name: string }>) {
  return senderId === meId ? 'You recalled a message' : `${users.get(senderId)?.name ?? 'Someone'} recalled a message`
}

/** 服务消息的文案；自己显示为 You（不在句首时为 you），资料未到时显示 Someone */
export function describeAction(action: ServiceAction, senderId: string, meId: string, users: Map<string, { name: string }>) {
  const name = (id: string, initial = true) => (id === meId ? (initial ? 'You' : 'you') : (users.get(id)?.name ?? 'Someone'))
  const list = (ids: string[], initial = true) =>
    new Intl.ListFormat('en', { type: 'conjunction' }).format(ids.map((id, i) => name(id, initial && i === 0)))
  const actor = name(senderId)
  switch (action.type) {
    case 'chat_create':
      return `${actor} created the group “${action.title}”`
    case 'members_add':
      return `${actor} added ${list(action.user_ids, false)}`
    case 'member_remove':
      return `${actor} removed ${name(action.user_id, false)}`
    case 'member_leave':
      return action.new_owner_id
        ? `${actor} left the group. ${name(action.new_owner_id)} ${action.new_owner_id === meId ? 'are' : 'is'} now the owner`
        : `${actor} left the group`
    case 'member_join':
      return `${actor} joined the group via invite link`
    case 'title_edit':
      return `${actor} renamed the group to “${action.title}”`
    case 'message_pin':
      return `${actor} pinned “${describeExcerpt(action.excerpt)}”`
    case 'call':
      return describeCall(action.result, senderId === meId, action.duration)
    case 'group_call':
      return action.duration === undefined ? `${actor} started a group call` : `Group call (${formatDuration(action.duration)})`
    case 'secret_create':
      return `${actor} started a secret chat`
    case 'secret_devices':
      return action.user_ids.length === 1 && action.user_ids[0] === meId
        ? 'You signed in on a new device. The safety code has changed'
        : `${list(action.user_ids)} signed in on a new device. The safety code has changed`
  }
}

/** 通话记录的文案：按自己是主叫方（outgoing）还是被叫方区分 */
export function describeCall(result: CallResult, outgoing: boolean, duration = 0) {
  if (result === 'ended') return `${outgoing ? 'Outgoing' : 'Incoming'} call (${formatDuration(duration)})`
  if (!outgoing) return isMissedCall(result) ? 'Missed call' : 'Declined call'
  switch (result) {
    case 'declined':
      return 'Call declined'
    case 'canceled':
      return 'Canceled call'
    case 'missed':
      return 'No answer'
    case 'busy':
      return 'Line busy'
  }
}
