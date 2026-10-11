// 未听：别人发来、本地库建立之后（kv.created_at）发来、本设备还没播放过的语音消息。只记在本地库的 played 表
// 见 CONTEXT.md「未听」

/** 消息 m 是未听的语音消息；?3 为自己的 user_id */
const UNPLAYED = `
  m.kind = 'media' AND json_extract(m.media, '$[0].type') = 'voice' AND m.sender_id != ?3
  AND m.date >= coalesce((SELECT value FROM kv WHERE key = 'created_at'), 0)
  AND NOT EXISTS (SELECT 1 FROM played p WHERE p.chat_id = m.chat_id AND p.seq = m.seq)`

/** 第 ?2 条消息是不是未听；参数：chat_id、seq、自己的 user_id */
export const IS_UNPLAYED_SQL = `SELECT 1 AS unplayed FROM messages m WHERE m.chat_id = ?1 AND m.seq = ?2 AND ${UNPLAYED}`

/** 同一会话里第 ?2 条之后的第一条未听语音，连播用；参数同上 */
export const NEXT_UNPLAYED_SQL = `
  SELECT m.seq, m.sender_id, m.media FROM messages m
  WHERE m.chat_id = ?1 AND m.seq > ?2 AND ${UNPLAYED}
  ORDER BY m.seq LIMIT 1`
