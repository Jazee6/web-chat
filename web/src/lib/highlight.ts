/** 一段文字，match 表示命中了某个关键词 */
export type Segment = { text: string; match: boolean }

/**
 * 搜索结果的片段：空白压成一个空格，标出所有关键词（不区分大小写）。
 * 第一个命中之前最多保留 context 个字符，更早的用省略号代替，让命中处出现在单行截断的可见范围内（侧栏里前面还有发送者）
 */
export function highlight(body: string, terms: string[], context = 10): Segment[] {
  const text = body.replace(/\s+/gu, ' ').trim()
  if (terms.length === 0) return [{ text, match: false }]
  const escaped = [...terms].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  const pattern = new RegExp(escaped.join('|'), 'giu')

  const first = text.search(pattern)
  let start = first > context ? first - context : 0
  // 不要从代理对中间切开
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(text[start]!)) start--

  const segments: Segment[] = start > 0 ? [{ text: '…', match: false }] : []
  let at = start
  pattern.lastIndex = start
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    if (m.index > at) segments.push({ text: text.slice(at, m.index), match: false })
    segments.push({ text: m[0], match: true })
    at = m.index + m[0].length
  }
  if (at < text.length) segments.push({ text: text.slice(at), match: false })
  return segments
}
