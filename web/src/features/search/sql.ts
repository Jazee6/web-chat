// 本地搜索的 SQL：全局搜索与会话内搜索共用。见 docs/architecture/07-client.md § 本地搜索
//
// 输入按空白拆成关键词，全部命中才算匹配。≥3 个字符的关键词走 FTS5 trigram，更短的退化为 LIKE。
// 只搜各会话 min_seq 之后连续的部分：更早的行只是回复引用，定位过去也显示不出来

/** trigram 分词器能索引的最短关键词（按字符计） */
const TRIGRAM_MIN = 3

export type SqlQuery = { sql: string; params: unknown[] }

/** trigram 按 Unicode 码点切分，不是 UTF-16 长度，也不是字素簇 */
const codePoints = (s: string) => Array.from(s).length

/** 拆出关键词：按空白分开、去重；没有关键词时返回空数组 */
export function searchTerms(input: string): string[] {
  return [...new Set(input.split(/\s+/u).filter((t) => t !== ''))]
}

/** 每个关键词作为一个短语：双引号转义，避免 FTS5 把 -、*、: 等当成语法 */
function ftsMatch(terms: string[]): string {
  return terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' ')
}

/** LIKE 子串匹配：转义通配符，配合 ESCAPE '\' */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`
}

export type MessageHit = {
  chat_id: string
  seq: number
  /** 命中的正文或文件名 */
  body: string
  sender_id: string
  date: number
  kind: 'text' | 'media'
  /** 会话名：群名或私聊对方的名字 */
  name: string | null
  image: string | null
}

/** 搜索消息，新的在前；chatId 为空时搜索所有会话 */
export function messageSearch(terms: string[], { chatId, limit }: { chatId?: string; limit: number }): SqlQuery {
  const long = terms.filter((t) => codePoints(t) >= TRIGRAM_MIN)
  const short = terms.filter((t) => codePoints(t) < TRIGRAM_MIN)
  const where = ['s.seq >= c.min_seq']
  const params: unknown[] = []
  if (long.length > 0) {
    where.push('s.id IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?)')
    params.push(ftsMatch(long))
  }
  for (const t of short) {
    where.push("s.body LIKE ? ESCAPE '\\'")
    params.push(likePattern(t))
  }
  if (chatId !== undefined) {
    where.push('s.chat_id = ?')
    params.push(chatId)
  }
  params.push(limit)
  return {
    sql: `
      SELECT s.chat_id, s.seq, s.body, m.sender_id, m.date, m.kind, coalesce(d.title, u.name) AS name, u.image
      FROM search s
      JOIN chats c ON c.chat_id = s.chat_id
      JOIN messages m ON m.chat_id = s.chat_id AND m.seq = s.seq
      JOIN dialogs d ON d.chat_id = s.chat_id
      LEFT JOIN people u ON u.id = d.peer_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.date DESC, s.seq DESC
      LIMIT ?`,
    params,
  }
}

/** 按会话名（群名，或私聊对方的备注名与名字）筛选对话的条件，拼在对话列表查询的 WHERE 后 */
export function dialogNameFilter(terms: string[]): SqlQuery {
  return {
    sql: terms.map(() => "(coalesce(d.title, u.name) LIKE ? ESCAPE '\\' OR u.own_name LIKE ? ESCAPE '\\')").join(' AND '),
    params: terms.flatMap((t) => [likePattern(t), likePattern(t)]),
  }
}
