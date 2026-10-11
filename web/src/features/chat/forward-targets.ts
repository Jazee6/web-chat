// 转发选择器的候选会话

export type ForwardTarget = { chat_id: string; name: string | null; own_name: string | null; image: string | null }

// 可以转发到的会话：自己还是成员的对话（不含我拉黑了的私聊与秘密聊天），以及还没有私聊的联系人。
// 对话按对话列表的顺序，联系人按名字
export const FORWARD_TARGETS_SQL = `
  SELECT chat_id, name, own_name, image FROM (
    SELECT d.chat_id, coalesce(d.title, u.name) AS name, u.own_name, u.image, 0 AS grp, d.pinned_rank AS rank, d.top_date AS date
    FROM dialogs d LEFT JOIN people u ON u.id = d.peer_id
    WHERE d.status = 'member' AND d.kind != 'secret' AND coalesce(u.blocked, 0) = 0
    UNION ALL
    SELECT CASE WHEN ?1 < p.id THEN 'p:' || ?1 || ':' || p.id ELSE 'p:' || p.id || ':' || ?1 END, p.name, p.own_name, p.image, 1, NULL, NULL
    FROM people p
    WHERE p.contact = 1 AND p.blocked = 0 AND p.id != ?1 AND NOT EXISTS (SELECT 1 FROM dialogs d WHERE d.peer_id = p.id AND d.kind = 'private')
  )
  ORDER BY grp, rank DESC NULLS LAST, date DESC, name COLLATE NOCASE`
