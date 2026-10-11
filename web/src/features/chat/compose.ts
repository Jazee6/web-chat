import type { MessageEntity } from 'shared/protocol'

/** 输入框当前针对的消息：回复某条消息，或编辑自己的一条消息（entities 为原来的提及，只在编辑时有） */
export type ComposeTarget = { mode: 'reply' | 'edit'; seq: number; senderId: string; text: string; entities?: MessageEntity[] }
