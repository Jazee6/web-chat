import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'

export type UserInfo = { id: string; name: string; image: string | null }

const USERS_SQL = 'SELECT id, name, image FROM people'

/** 本地缓存的全部用户资料（对话列表、群成员与联系人涉及的用户，数量很少）；name 为备注名或对方自己的名字 */
export function useUsers(): Map<string, UserInfo> {
  const rows = useLiveQuery<UserInfo>(USERS_SQL, [], [topics.users])
  return new Map((rows ?? []).map((u) => [u.id, u]))
}
