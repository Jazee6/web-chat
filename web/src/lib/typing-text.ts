import type { Typist } from '@/sync/transient'

/**
 * 正在输入的人：私聊（users 为 null）只写动作；群组一两个人写出名字，更多时只写人数。
 * 都在录音时写录音，否则写打字
 */
export function typingText(typists: Typist[], users: Map<string, { name: string }> | null) {
  const verb = typists.every((t) => t.action === 'recording') ? 'recording voice…' : 'typing…'
  if (!users) return verb
  const name = (id: string) => users.get(id)?.name ?? 'Someone'
  const [a, b] = typists
  if (typists.length === 1) return `${name(a!.user_id)} is ${verb}`
  if (typists.length === 2) return `${name(a!.user_id)} and ${name(b!.user_id)} are ${verb}`
  return `${typists.length} people are ${verb}`
}
