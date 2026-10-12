const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * 一个字素是否是 emoji：国旗、键帽，或以图形符号开头、后面只跟肤色、变体选择符、ZWJ 序列与 tag 的组合。
 * 默认按文字显示的单个符号（© ™ ↔）不算，除非带 U+FE0F
 */
const EMOJI =
  /^(?:\p{Regional_Indicator}{2}|[0-9#*]️?⃣|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)[\p{Emoji_Modifier}️‍\p{Extended_Pictographic}\u{E0020}-\u{E007F}]*)$/u

/** 最多几个 emoji 连在一起时放大显示 */
const MAX_JUMBO = 3

/** 正文（去掉首尾空白后）是否是 1–3 个连续的 emoji，中间不夹空白和其他文字 */
export function isJumboEmoji(text: string) {
  const parts = [...graphemes.segment(text.trim())]
  return parts.length > 0 && parts.length <= MAX_JUMBO && parts.every((p) => EMOJI.test(p.segment))
}
