// 推送通知的判定与文案：哪条消息推送、推给谁、显示什么。纯函数，由 UserDO 调用。
// 见 docs/architecture/04-realtime-and-fanout.md § Web Push
import { isMissedCall, summarizeMedia, type ChatKind, type Message } from 'shared/protocol'
import { describeAction, describeMedia, describeRecall } from 'shared/text'
import type { FanoutEvent } from '../chat-do'

/** VAPID 的 sub：推送服务出问题时据此联系应用方 */
export const PUSH_SUBJECT = 'https://chat.jaze.top'

/** 推送服务的域名（含子域名）。订阅的 endpoint 只能指向这些，免得被拿来让 UserDO 向任意地址发请求 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']

/** 通知正文最多多少个字符 */
const BODY_LENGTH = 200

export function isPushService(endpoint: string): boolean {
  const { protocol, hostname } = new URL(endpoint)
  return protocol === 'https:' && PUSH_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

/** 新消息是否推送：普通消息与媒体消息（含秘密聊天的），未接来电，群组通话发起，开始秘密聊天，以及把自己拉进群、移出群的服务消息 */
function notifies(m: Message, selfId: string): boolean {
  if (m.sender_id === selfId) return false
  switch (m.kind) {
    case 'text':
    case 'media':
    case 'cipher':
      return true
    case 'service': {
      const a = m.action
      if (a.type === 'chat_create' || a.type === 'members_add') return a.user_ids.includes(selfId)
      // 未接来电（自己是被叫方）；群组通话发起时（结束时的改写不算新消息）
      if (a.type === 'call') return isMissedCall(a.result)
      if (a.type === 'group_call' || a.type === 'secret_create') return true
      return a.type === 'member_remove' && a.user_id === selfId
    }
    case 'recalled':
      return false
  }
}

/**
 * 一批扇出事件里要推送的消息（每个会话只推一次）：
 * - 有要推送的新消息：推最新的一条；
 * - 否则，对话的最后一条消息被撤回或编辑（摘要随之变化，对话行的 chat_pts 前移到了这条变更）、且仍未读：静默替换原通知。
 *   回应不改变摘要，不推。关闭了通知预览时通知里本来就没有正文，不推。
 * pts 不大于 appliedPts（应用这批事件之前对话行的 chat_pts）的事件已经处理过，是扇出重试，不再推送。
 * 静音的对话（onlyMentions）只推提及我（或回复我）的新消息，不做静默替换
 */
export function pickPush(
  events: FanoutEvent[],
  dialog: { top_seq: number; last_read_seq: number; chat_pts: number },
  appliedPts: number,
  selfId: string,
  preview: boolean,
  onlyMentions = false,
): { message: Message; silent: boolean } | null {
  const fresh = events.flatMap((e) => (e.type !== 'peer_read' && e.type !== 'chat_deleted' && e.message.pts > appliedPts ? [e] : []))
  const unread = (m: Message) => m.seq > dialog.last_read_seq
  const latest = (ms: Message[]) => ms.reduce<Message | null>((a, m) => (a && a.seq > m.seq ? a : m), null)

  const added = latest(
    fresh.flatMap((e) =>
      e.type === 'new_message' &&
      notifies(e.message, selfId) &&
      unread(e.message) &&
      (!onlyMentions || e.mentioned?.includes(selfId) === true)
        ? [e.message]
        : [],
    ),
  )
  if (added) return { message: added, silent: false }
  if (!preview || onlyMentions) return null
  const changed = latest(
    fresh.flatMap((e) =>
      e.type === 'update_message' &&
      e.message.seq === dialog.top_seq &&
      e.message.pts <= dialog.chat_pts &&
      unread(e.message) &&
      e.message.sender_id !== selfId
        ? [e.message]
        : [],
    ),
  )
  return changed ? { message: changed, silent: true } : null
}

/** 渲染文案要用到名字的用户：发送者与服务消息涉及的成员 */
export function mentionedUsers(m: Message): string[] {
  if (m.kind !== 'service') return [m.sender_id]
  const a = m.action
  switch (a.type) {
    case 'chat_create':
    case 'members_add':
    case 'secret_devices':
      return [m.sender_id, ...a.user_ids]
    case 'member_remove':
      return [m.sender_id, a.user_id]
    case 'member_leave':
      return a.new_owner_id ? [m.sender_id, a.new_owner_id] : [m.sender_id]
    case 'member_join':
    case 'title_edit':
    case 'message_pin':
    case 'call':
    case 'group_call':
    case 'secret_create':
      return [m.sender_id]
  }
}

/**
 * 通知的标题与正文。私聊：标题为发送者；群组：标题为群名，正文前加"发送者: "（服务消息与撤回的文案自带动作者）。
 * 关闭通知预览时、以及秘密聊天的消息（服务端读不懂）正文只写 New message
 */
export function renderNotification(
  m: Message,
  chat: { kind: ChatKind; title: string | null },
  selfId: string,
  users: Map<string, { name: string }>,
  preview: boolean,
): { title: string; body: string } {
  const sender = users.get(m.sender_id)?.name ?? 'Someone'
  const title = chat.kind === 'group' ? (chat.title ?? 'Group') : sender
  const prefix = chat.kind === 'group' ? `${sender}: ` : ''
  if (!preview) return { title, body: `${prefix}New message` }
  switch (m.kind) {
    case 'text':
      return { title, body: prefix + m.text.slice(0, BODY_LENGTH) }
    case 'media':
      return { title, body: prefix + describeMedia(summarizeMedia(m.media)) }
    case 'service':
      return { title, body: describeAction(m.action, m.sender_id, selfId, users) }
    case 'recalled':
      return { title, body: describeRecall(m.sender_id, selfId, users) }
    case 'cipher':
      return { title, body: 'New message' }
  }
}
