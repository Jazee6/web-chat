// 输入框里的提及：光标前正在输入的 @，以及发送前从文字里找出提及的位置
import type { MessageEntity } from 'shared/protocol'

/**
 * 发送前从文字里找出提及：picked 为在候选列表里选过的人（插入的是对方自己的名字），
 * 文字里每个仍然完整的 @名字 都算一次；同名时以后选的为准，重叠的只取靠前的
 */
export function findMentions(text: string, picked: { user_id: string; name: string }[]): MessageEntity[] {
  const byName = new Map(picked.map((p) => [p.name, p.user_id]))
  const found: MessageEntity[] = []
  for (const [name, userId] of byName) {
    const token = `@${name}`
    for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + token.length)) {
      found.push({ type: 'mention', offset: i, length: token.length, user_id: userId })
    }
  }
  found.sort((a, b) => a.offset - b.offset || b.length - a.length)
  const result: MessageEntity[] = []
  let end = 0
  for (const e of found) {
    if (e.offset < end) continue
    result.push(e)
    end = e.offset + e.length
  }
  return result
}

/** 光标前正在输入的提及：@ 之后到光标的文字（不含空白）；没有返回 null */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]{0,32})$/.exec(text.slice(0, caret))
  if (!match) return null
  return { start: caret - match[1]!.length - 1, query: match[1]! }
}
