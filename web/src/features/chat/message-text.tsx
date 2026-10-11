import type { ReactNode, Ref } from 'react'
import { Link } from '@tanstack/react-router'
import type { MessageEntity } from 'shared/protocol'
import { findLinks } from 'shared/text'

import { useOpenLink } from '@/features/link/open-link'
import { inPip } from '@/features/pip/pip'

/**
 * 消息正文：提及显示为指向对方资料页的链接（画中画里不跳转），文字是发送时的名字；
 * 夹在文字里的 http(s) 链接可以点击，提及覆盖的部分不再识别链接
 */
export function MessageText({
  text,
  entities,
  ref,
}: {
  text: string
  entities: MessageEntity[] | null
  ref?: Ref<HTMLParagraphElement>
}) {
  const parts: ReactNode[] = []
  let at = 0
  const plain = (end: number) => {
    const slice = text.slice(at, end)
    let pos = 0
    for (const link of findLinks(slice)) {
      if (link.offset > pos) parts.push(slice.slice(pos, link.offset))
      const label = slice.slice(link.offset, link.offset + link.length)
      parts.push(<InlineLink key={`l${at + link.offset}`} url={link.url} label={label} />)
      pos = link.offset + link.length
    }
    parts.push(slice.slice(pos))
    at = end
  }
  for (const e of entities ?? []) {
    if (e.offset < at) continue
    plain(e.offset)
    const label = text.slice(e.offset, e.offset + e.length)
    parts.push(
      inPip ? (
        <span key={e.offset} className="font-medium">
          {label}
        </span>
      ) : (
        <Link key={e.offset} to="/u/$userId" params={{ userId: e.user_id }} className="font-medium hover:underline">
          {label}
        </Link>
      ),
    )
    at = e.offset + e.length
  }
  plain(text.length)
  return (
    <p ref={ref} className="whitespace-pre-wrap">
      {parts}
    </p>
  )
}

function InlineLink({ url, label }: { url: URL; label: string }) {
  const open = useOpenLink(url)
  return (
    <a {...open} className="break-all underline underline-offset-2">
      {label}
    </a>
  )
}
