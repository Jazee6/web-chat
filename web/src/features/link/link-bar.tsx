import { LinkIcon, XIcon } from 'lucide-react'

import { InputGroupButton } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { displayHost } from './open-link'
import type { Resolved } from './use-link-preview'

/** 输入框上方的一条预览，像回复栏一样：小图（或链接图标、转圈）、标题与域名，点 ✕ 这次不带卡片 */
export function LinkBar({ url, resolved, onDismiss }: { url: URL; resolved: Resolved | null; onDismiss: () => void }) {
  const host = displayHost(url)
  const title = resolved?.preview.title
  return (
    <Item variant="quote" size="xs">
      {resolved?.thumb ? (
        <ItemMedia variant="image">
          <img src={resolved.thumb} alt="" />
        </ItemMedia>
      ) : (
        <ItemMedia variant="icon">{resolved ? <LinkIcon /> : <Spinner />}</ItemMedia>
      )}
      <ItemContent>
        {/* 没有标题时标题行就是域名，不再重复一行 */}
        <ItemTitle>{title ?? host}</ItemTitle>
        {resolved?.preview.type === 'invite' ? (
          <ItemDescription>Group invite</ItemDescription>
        ) : (
          title && <ItemDescription>{host}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        <InputGroupButton size="icon-xs" aria-label="Remove link preview" onClick={onDismiss}>
          <XIcon />
        </InputGroupButton>
      </ItemActions>
    </Item>
  )
}
