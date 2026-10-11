import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { MAX_ALIAS_LENGTH, privateChatId } from 'shared/protocol'
import * as v from 'valibot'

import { ResponsiveDialog, type DialogFooterComponent } from '@/components/responsive-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useSidebar } from '@/components/ui/sidebar'
import { useMe } from '@/features/auth/me'
import { call, OpFailure } from '@/sync/client'
import { useSidebarPanel } from './panel-context'

const schema = v.object({
  // 空着时只提示一条
  email: v.config(
    v.pipe(v.string(), v.trim(), v.nonEmpty('Enter an email address.'), v.email('Enter a valid email address.')),
    { abortPipeEarly: true },
  ),
  alias: v.pipe(v.string(), v.trim(), v.maxLength(MAX_ALIAS_LENGTH, `Use ${MAX_ALIAS_LENGTH} characters or fewer.`)),
})

const LOOKUP_ERRORS: Partial<Record<string, string>> = {
  not_found: 'No one is using this email address.',
  offline: "You're offline. Try again when you're back online.",
}

/** 按邮箱添加联系人（忽略大小写的精确匹配），加好后直接打开与他的私聊 */
export function AddContact({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add contact"
      description="Enter the email address of the person you’d like to add."
    >
      {(Footer) => <AddContactForm onDone={() => onOpenChange(false)} Footer={Footer} />}
    </ResponsiveDialog>
  )
}

function AddContactForm({ onDone, Footer }: { onDone: () => void; Footer: DialogFooterComponent }) {
  const me = useMe()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  const { setPanel } = useSidebarPanel()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { email: '', alias: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      try {
        const user = await call('resolveUser', { email: value.email.trim() })
        if (user.id === me.id) {
          setSubmitError("That's your own email address.")
          return
        }
        // 已经是联系人时，没填备注名就保留原来的
        const [existing] = await call('query', { sql: 'SELECT 1 FROM relations WHERE user_id = ? AND contact = 1', params: [user.id] })
        const alias = value.alias.trim()
        if (!existing || alias) await call('setContact', { userId: user.id, alias: alias || null })
        onDone()
        setPanel('chats')
        if (isMobile) setOpenMobile(false)
        await navigate({ to: '/c/$chatId', params: { chatId: privateChatId(me.id, user.id) } })
      } catch (e) {
        setSubmitError((e instanceof OpFailure && LOOKUP_ERRORS[e.code]) || "Couldn't add this contact. Try again.")
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
          <form.Field name="email">
            {(field) => {
              const errors = [...field.state.meta.errors, ...(submitError ? [{ message: submitError }] : [])]
              const invalid = errors.length > 0
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="contact-email">Email</FieldLabel>
                  <Input
                    id="contact-email"
                    name={field.name}
                    type="email"
                    autoComplete="off"
                    autoFocus
                    placeholder="name@example.com"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value)
                      setSubmitError(null)
                    }}
                    aria-invalid={invalid}
                  />
                  <FieldError errors={errors} />
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="alias">
            {(field) => {
              const invalid = field.state.meta.errors.length > 0
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="contact-alias">Name (optional)</FieldLabel>
                  <Input
                    id="contact-alias"
                    name={field.name}
                    autoComplete="off"
                    maxLength={MAX_ALIAS_LENGTH}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={invalid}
                  />
                  <FieldDescription>Only you see this name. Leave it empty to use theirs.</FieldDescription>
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
              Add
            </Button>
          </Footer>
        )}
      </form.Subscribe>
    </form>
  )
}
