import type { RefObject } from 'react'

import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { UserAvatar } from '@/components/user-avatar'

/** 可以提及的人：name 为显示用的名字（备注名优先），own_name 为对方自己的名字，插进文字里的是它 */
export type MentionCandidate = { id: string; name: string; own_name: string; image: string | null }

/**
 * 输入框上方的提及候选列表，有候选时打开，与 anchor 同宽。焦点始终留在输入框里：上下键选择、Enter / Tab 选中、
 * Esc 关闭，由输入框处理；打开、关闭都不移动焦点，鼠标按下时也不抢走焦点。
 * 点输入框以外的地方不关闭：候选只随光标前的文字变化
 */
export function MentionPicker({
  anchor,
  candidates,
  active,
  onPick,
  onHover,
  onDismiss,
}: {
  anchor: RefObject<HTMLElement | null>
  candidates: MentionCandidate[]
  active: number
  onPick: (candidate: MentionCandidate) => void
  onHover: (index: number) => void
  onDismiss: () => void
}) {
  return (
    <Popover
      open={candidates.length > 0}
      onOpenChange={(open, details) => {
        if (!open && details.reason === 'escape-key') onDismiss()
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="top"
        align="start"
        layout="list"
        initialFocus={false}
        finalFocus={false}
        aria-label="Mention someone"
      >
        <ItemGroup id="mention-picker" role="listbox" aria-label="Mention someone">
          {candidates.map((c, i) => (
            <Item
              key={c.id}
              id={`mention-${c.id}`}
              role="option"
              aria-selected={i === active}
              size="xs"
              variant={i === active ? 'muted' : 'default'}
              render={<button type="button" />}
              className="cursor-pointer text-left"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(c)}
            >
              <ItemMedia>
                <UserAvatar name={c.name} image={c.image} size="sm" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{c.name}</ItemTitle>
                {c.name !== c.own_name && <ItemDescription>{c.own_name}</ItemDescription>}
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      </PopoverContent>
    </Popover>
  )
}
