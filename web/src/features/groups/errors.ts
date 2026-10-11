import { MAX_PINNED_DIALOGS, MAX_STICKERS } from 'shared/protocol'

import { OpFailure } from '@/sync/client'

const MESSAGES: Partial<Record<string, string>> = {
  offline: "You're offline. Try again when you're back online.",
  not_found: 'Someone you added no longer has an account.',
  chat_full: 'This group is full.',
  forbidden: 'You don’t have permission to do that.',
  expired: 'It’s too late to change this message.',
  blocked: 'You can’t message this person.',
  pin_limit: `You can pin up to ${MAX_PINNED_DIALOGS} chats. Unpin one first.`,
  sticker_limit: `You can save up to ${MAX_STICKERS} stickers. Remove one first.`,
  no_keys: 'They haven’t opened the app on any device yet.',
  not_ready: 'Encryption isn’t set up on this device yet. Try again in a moment.',
}

const list = new Intl.ListFormat('en', { type: 'conjunction' })

/** 操作失败时给用户看的文案 */
export function opErrorMessage(e: unknown, fallback: string): string {
  return (e instanceof OpFailure && MESSAGES[e.code]) || fallback
}

/** 建群、加人失败的文案：有人拉黑了自己时指出是谁（名字取自选中的成员） */
export function membersErrorMessage(e: unknown, members: { id: string; name: string }[], fallback: string): string {
  if (e instanceof OpFailure && e.code === 'blocked' && e.userIds?.length) {
    const names = e.userIds.map((id) => members.find((m) => m.id === id)?.name || 'Someone')
    return `${list.format(names)} can’t be added. Remove ${names.length === 1 ? 'them' : 'these people'} and try again.`
  }
  return opErrorMessage(e, fallback)
}
