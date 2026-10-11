import { highlight } from '@/lib/highlight'

/** 搜索结果的单行片段，关键词加粗 */
export function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return highlight(text, terms).map((segment, i) =>
    segment.match ? (
      <mark key={i} className="bg-transparent font-medium text-foreground">
        {segment.text}
      </mark>
    ) : (
      segment.text
    ),
  )
}
