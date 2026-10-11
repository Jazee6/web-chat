import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { MAX_GROUP_MEMBERS, MAX_TITLE_LENGTH, newGroupChatId, type UserProfile } from 'shared/protocol'
import * as v from 'valibot'

import { ResponsiveDialog, type DialogFooterComponent } from '@/components/responsive-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useSidebar } from '@/components/ui/sidebar'
import { call } from '@/sync/client'
import { randomId } from '@/sync/logic'
import { MemberPicker } from './member-picker'
import { membersErrorMessage } from './errors'

const schema = v.object({
  title: v.pipe(
    v.string(),
    v.trim(),
    v.nonEmpty('Enter a group name.'),
    v.maxLength(MAX_TITLE_LENGTH, `Use ${MAX_TITLE_LENGTH} characters or fewer.`),
  ),
  members: v.pipe(v.array(v.custom<UserProfile>(() => true)), v.minLength(1, 'Add at least one member.')),
})

/** 新建群组：群名必填，至少 1 名其他成员 */
export function NewGroup({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New group"
      description="Name your group and add people from your contacts."
    >
      {(Footer) => <NewGroupForm onDone={() => onOpenChange(false)} Footer={Footer} />}
    </ResponsiveDialog>
  )
}

function NewGroupForm({ onDone, Footer }: { onDone: () => void; Footer: DialogFooterComponent }) {
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  // 同一次建群的重试沿用同一组 ID：响应丢失后重交不会建出第二个群
  const [ids] = useState(() => ({ chatId: newGroupChatId(), randomId: randomId() }))
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { title: '', members: [] as UserProfile[] },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      try {
        await call('createGroup', {
          chatId: ids.chatId,
          randomId: ids.randomId,
          title: value.title.trim(),
          userIds: value.members.map((u) => u.id),
        })
        onDone()
        if (isMobile) setOpenMobile(false)
        await navigate({ to: '/c/$chatId', params: { chatId: ids.chatId } })
      } catch (e) {
        setSubmitError(membersErrorMessage(e, value.members, "Couldn't create the group. Try again."))
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
          <form.Field name="title">
            {(field) => {
              const invalid = field.state.meta.errors.length > 0
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="group-title">Group name</FieldLabel>
                  <Input
                    id="group-title"
                    name={field.name}
                    autoComplete="off"
                    autoFocus
                    maxLength={MAX_TITLE_LENGTH}
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
          <form.Field name="members">
            {(field) => (
              <MemberPicker
                id="group-members"
                value={field.state.value}
                onChange={field.handleChange}
                max={MAX_GROUP_MEMBERS - 1}
                errors={[...field.state.meta.errors, ...(submitError ? [{ message: submitError }] : [])]}
              />
            )}
          </form.Field>
        </FieldGroup>
      </div>
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(submitting) => (
          <Footer>
            <Button type="submit" disabled={submitting}>
              {submitting && <Spinner data-icon="inline-start" />}
              Create group
            </Button>
          </Footer>
        )}
      </form.Subscribe>
    </form>
  )
}
