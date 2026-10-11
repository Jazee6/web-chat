import type { UserProfile } from 'shared/protocol'

import { CommandListSkeleton } from '@/components/command-list-skeleton'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { UserAvatar } from '@/components/user-avatar'
import { useContacts } from '@/features/contacts/queries'

/**
 * 从联系人中选成员（点一下选中，再点取消）。已经在群里的人不列出；
 * 表单级错误（例如一个都没选、有人拉黑了自己）由调用方经 errors 传入
 */
export function MemberPicker({
  id,
  value,
  onChange,
  excludeIds = [],
  max,
  errors = [],
}: {
  id: string
  value: UserProfile[]
  onChange: (value: UserProfile[]) => void
  /** 已经在群里的人 */
  excludeIds?: string[]
  /** 最多还能选几个人 */
  max: number
  errors?: ({ message?: string } | undefined)[]
}) {
  const contacts = useContacts()?.filter((c) => !excludeIds.includes(c.id))
  const full = value.length >= max
  const invalid = errors.length > 0

  const toggle = (user: UserProfile) =>
    onChange(value.some((u) => u.id === user.id) ? value.filter((u) => u.id !== user.id) : [...value, user])

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>Members</FieldLabel>
      {/* cmdk 用自己的 id 与隐藏 label 覆盖输入框的，名字只能经 Command 的 label 给。
          搜索框一直在，联系人还没取到时列表先占位 */}
      <Command variant="field" label="Members">
        <CommandInput id={id} placeholder="Search contacts" aria-invalid={invalid} />
        {contacts === undefined ? (
          <CommandListSkeleton />
        ) : (
          <CommandList>
            <CommandEmpty>{excludeIds.length > 0 ? 'No other contacts to add.' : 'No contacts found.'}</CommandEmpty>
            <CommandGroup>
              {contacts.map((contact) => {
                const user: UserProfile = { id: contact.id, name: contact.name ?? '', image: contact.image }
                const selected = value.some((u) => u.id === contact.id)
                return (
                  <CommandItem
                    key={contact.id}
                    value={contact.id}
                    keywords={[contact.name ?? '', contact.own_name ?? '']}
                    disabled={full && !selected}
                    data-checked={selected}
                    onSelect={() => toggle(user)}
                  >
                    <UserAvatar name={contact.name} image={contact.image} size="sm" />
                    <span className="truncate">{contact.name ?? '…'}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        )}
      </Command>
      <FieldDescription>
        {full
          ? 'This group is full.'
          : value.length > 0
            ? `${value.length} selected`
            : 'Only your contacts can be added. Add someone to your contacts first.'}
      </FieldDescription>
      <FieldError errors={errors} />
    </Field>
  )
}
