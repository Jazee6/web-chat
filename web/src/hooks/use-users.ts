import { topics } from '@/sync/bridge'
import { useLiveQuery } from '@/sync/live-query'

export type UserInfo = { id: string; name: string; image: string | null }

const USERS_SQL = 'SELECT id, name, image FROM people'

const EMPTY = new Map<string, UserInfo>()
/** 同一次查询结果的各个调用方（对话列表的每一项、每条搜索结果）共用一份 Map */
const maps = new WeakMap<UserInfo[], Map<string, UserInfo>>()

/** 本地缓存的全部用户资料（对话列表、群成员与联系人涉及的用户，数量很少）；name 为备注名或对方自己的名字 */
export function useUsers(): Map<string, UserInfo> {
  const rows = useLiveQuery<UserInfo>(USERS_SQL, [], [topics.users])
  if (!rows) return EMPTY
  let map = maps.get(rows)
  if (!map) {
    map = new Map(rows.map((u) => [u.id, u]))
    maps.set(rows, map)
  }
  return map
}
