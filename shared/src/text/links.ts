// 消息正文里的链接：判断纯链接消息（显示为链接预览卡片）、找出夹在文字中间的链接。
// 输入框、服务端校验与显示共用同一套规则，三处对"是不是卡片"的判断才不会不一致
import { parseInviteCode } from '../protocol'

/** 结尾的这些标点通常属于句子而不是链接 */
const TRAILING = /[.,;:!?'"’”)\]}>]+$/
const LINK = /https?:\/\/[^\s<>"'`]+/gi

function parse(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' ? url : null
  } catch {
    return null
  }
}

/** 去掉结尾的标点；括号在链接里配对时保留（例如维基百科的地址） */
function trimTrailing(raw: string): string {
  let s = raw
  for (;;) {
    const m = TRAILING.exec(s)
    if (!m) return s
    const last = s.at(-1)!
    if (last === ')' && (s.match(/\(/g)?.length ?? 0) >= (s.match(/\)/g)?.length ?? 0)) return s
    s = s.slice(0, -1)
  }
}

/**
 * 纯链接消息：正文去掉首尾空白后恰好是一个 http(s) 链接。返回这个链接，否则 null。
 * 链接本身原样保留（不去掉结尾标点），点击打开的就是正文
 */
export function linkOnly(text: string): URL | null {
  const s = text.trim()
  if (s === '' || /\s/.test(s) || !/^https?:\/\//i.test(s)) return null
  return parse(s)
}

/** 夹在文字中间的链接：位置以 UTF-16 码元计，结尾的标点不算 */
export function findLinks(text: string): { offset: number; length: number; url: URL }[] {
  const found: { offset: number; length: number; url: URL }[] = []
  for (const m of text.matchAll(LINK)) {
    const raw = trimTrailing(m[0])
    const url = parse(raw)
    if (url) found.push({ offset: m.index, length: raw.length, url })
  }
  return found
}

/** 本站的邀请链接（origin 为应用的 Origin）：返回邀请码 */
export function inviteCodeOf(url: URL, appOrigin: string): string | null {
  if (url.origin !== appOrigin) return null
  const m = /^\/join\/([^/]+)$/.exec(url.pathname)
  return m && parseInviteCode(m[1]!) ? m[1]! : null
}
