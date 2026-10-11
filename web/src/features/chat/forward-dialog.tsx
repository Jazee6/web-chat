import { useRef, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { MAX_FORWARD_TARGETS, MAX_TEXT_LENGTH } from 'shared/protocol'
import * as v from 'valibot'

import { CommandListSkeleton } from '@/components/command-list-skeleton'
import { ResponsiveDialog, type DialogFooterComponent } from '@/components/responsive-dialog'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { UserAvatar } from '@/components/user-avatar'
import { useMe } from '@/features/auth/me'
import { opErrorMessage } from '@/features/groups/errors'
import { inPip } from '@/features/pip/pip'
import { topics } from '@/sync/bridge'
import { call } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'
import { randomId } from '@/sync/logic'
import { FORWARD_TARGETS_SQL, type ForwardTarget } from './forward-targets'

const schema = v.object({
  targets: v.pipe(
    v.array(v.string()),
    v.minLength(1, 'Choose at least one chat.'),
    v.maxLength(MAX_FORWARD_TARGETS, `Choose up to ${MAX_FORWARD_TARGETS} chats.`),
  ),
  comment: v.pipe(v.string(), v.maxLength(MAX_TEXT_LENGTH, `Use ${MAX_TEXT_LENGTH} characters or fewer.`)),
})

/** 转发一条消息：选 1–MAX_FORWARD_TARGETS 个会话，可以附带一段文字（在每个会话里另成一条，排在转发的消息之后） */
export function ForwardDialog({
  chatId,
  seq,
  open,
  onOpenChange,
}: {
  chatId: string
  seq: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Forward message" description="Choose the chats to forward it to.">
      {(Footer) => <ForwardForm fromChatId={chatId} seq={seq} Footer={Footer} onDone={() => onOpenChange(false)} />}
    </ResponsiveDialog>
  )
}

function ForwardForm({
  fromChatId,
  seq,
  Footer,
  onDone,
}: {
  fromChatId: string
  seq: number
  Footer: DialogFooterComponent
  onDone: () => void
}) {
  const me = useMe()
  const navigate = useNavigate()
  const targets = useLiveQuery<ForwardTarget>(FORWARD_TARGETS_SQL, [me.id], [topics.dialogs, topics.users])
  // 每个目标的 random_id 在这次打开期间不变：部分失败后重试，已经转发过的不会重复
  const ids = useRef(new Map<string, { forward: number; comment: number }>())
  const done = useRef(new Set<string>())
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { targets: [] as string[], comment: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const comment = value.comment.trim()
      const failed: { chatId: string; error: unknown }[] = []
      // 逐个会话转发，附带的文字排在转发的消息之后
      for (const toChatId of value.targets) {
        if (done.current.has(toChatId)) continue
        let id = ids.current.get(toChatId)
        if (!id) ids.current.set(toChatId, (id = { forward: randomId(), comment: randomId() }))
        try {
          await call('forward', { fromChatId, seq, toChatId, randomId: id.forward })
          if (comment) await call('send', { chatId: toChatId, messages: [{ randomId: id.comment, text: comment }] })
          done.current.add(toChatId)
        } catch (error) {
          failed.push({ chatId: toChatId, error })
        }
      }
      if (failed.length > 0) {
        const names = failed.map((f) => targets?.find((t) => t.chat_id === f.chatId)?.name ?? 'a chat')
        const list = new Intl.ListFormat('en', { type: 'conjunction' }).format(names)
        setSubmitError(`Couldn't forward to ${list}. ${opErrorMessage(failed[0]!.error, 'Try again.')}`)
        return
      }
      onDone()
      // 只转发到一个会话时直接打开它（画中画里不跳转）
      if (value.targets.length === 1 && !inPip) {
        await navigate({ to: '/c/$chatId', params: { chatId: value.targets[0]! } })
      } else {
        toast.add({ title: `Forwarded to ${value.targets.length} chats` })
      }
    },
  })

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <div className="px-4 md:px-0">
        <FieldGroup>
          <form.Field name="targets">
            {(field) => {
              const errors = [...field.state.meta.errors, ...(submitError ? [{ message: submitError }] : [])]
              const invalid = errors.length > 0
              const selected = field.state.value
              const full = selected.length >= MAX_FORWARD_TARGETS
              const toggle = (chatId: string) =>
                field.handleChange(selected.includes(chatId) ? selected.filter((id) => id !== chatId) : [...selected, chatId])
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="forward-targets">Chats</FieldLabel>
                  {/* 搜索框先于列表出现：打开时焦点落在它上面，而不是下面的 Message。
                      cmdk 用自己的 id 与隐藏 label 覆盖输入框的，名字只能经 label 给 */}
                  <Command variant="field" label="Chats">
                    <CommandInput id="forward-targets" placeholder="Search chats" aria-invalid={invalid} />
                    {targets === undefined ? (
                      <CommandListSkeleton />
                    ) : (
                      <CommandList>
                        <CommandEmpty>No chats found.</CommandEmpty>
                        <CommandGroup>
                          {targets.map((t) => {
                            const checked = selected.includes(t.chat_id)
                            return (
                              <CommandItem
                                key={t.chat_id}
                                value={t.chat_id}
                                keywords={[t.name ?? '', t.own_name ?? '']}
                                disabled={full && !checked}
                                data-checked={checked}
                                onSelect={() => toggle(t.chat_id)}
                              >
                                <UserAvatar name={t.name} image={t.image} size="sm" />
                                <span className="truncate">{t.name ?? '…'}</span>
                              </CommandItem>
                            )
                          })}
                        </CommandGroup>
                      </CommandList>
                    )}
                  </Command>
                  <FieldDescription>
                    {selected.length > 0
                      ? `${selected.length} of ${MAX_FORWARD_TARGETS} selected`
                      : `Choose up to ${MAX_FORWARD_TARGETS} chats.`}
                  </FieldDescription>
                  <FieldError errors={errors} />
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="comment">
            {(field) => {
              const invalid = field.state.meta.errors.length > 0
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="forward-comment">Message</FieldLabel>
                  <Textarea
                    id="forward-comment"
                    name={field.name}
                    placeholder="Add a message (optional)"
                    rows={2}
                    maxLength={MAX_TEXT_LENGTH}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={invalid}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )
            }}
          </form.Field>
        </FieldGroup>
      </div>
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(submitting) => (
          <Footer>
            <Button type="submit" disabled={submitting}>
              {submitting && <Spinner data-icon="inline-start" />}
              Forward
            </Button>
          </Footer>
        )}
      </form.Subscribe>
    </form>
  )
}
