import { useState, type ReactNode } from 'react'
import { useForm } from '@tanstack/react-form'
import { Link, useNavigate } from '@tanstack/react-router'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { ArrowLeftIcon, EllipsisIcon, LogOutIcon, PencilIcon, UserMinusIcon, UserPlusIcon } from 'lucide-react'
import { MAX_GROUP_MEMBERS, MAX_TITLE_LENGTH, isGroupChatId, type UserProfile } from 'shared/protocol'
import * as v from 'valibot'

import { DataTable, DataTableSkeleton } from '@/components/data-table'
import { ResponsiveDialog, type DialogFooterComponent } from '@/components/responsive-dialog'
import { SkeletonText } from '@/components/skeleton-text'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { UserAvatar } from '@/components/user-avatar'
import { useMe } from '@/features/auth/me'
import { ChatNotFound } from '@/features/chat/chat-page'
import { useGroupDialog, useViewChat } from '@/features/chat/hooks'
import { topics } from '@/sync/bridge'
import { call } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'
import { randomId } from '@/sync/logic'
import { DeleteDialogButton } from './delete-dialog-button'
import { InviteLink } from './invite-link'
import { membersErrorMessage, opErrorMessage } from './errors'
import { MemberPicker } from './member-picker'
import { PlayerSlot } from '@/features/voice/player-bar'

type MemberRow = { user_id: string; role: 'owner' | 'member'; joined_at: number; name: string | null; image: string | null }

// 群主在前，其余按入群顺序；与服务端挑选接任群主的顺序一致
const MEMBERS_SQL = `
  SELECT m.user_id, m.role, m.joined_at, u.name, u.image
  FROM chat_members m LEFT JOIN people u ON u.id = m.user_id
  WHERE m.chat_id = ?
  ORDER BY m.role = 'owner' DESC, m.joined_at, m.user_id`

export function GroupInfoPage({ chatId }: { chatId: string }) {
  const valid = isGroupChatId(chatId)
  useViewChat(chatId, valid)
  const { isMobile } = useSidebar()
  const dialog = useGroupDialog(chatId)

  if (!valid || dialog === null) return <ChatNotFound />

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        {/* 手机上只留返回：左栏在这里只是个抽屉，和返回并排容易混淆 */}
        {!isMobile && <SidebarTrigger />}
        <Button variant="ghost" size="icon-sm" aria-label="Back to chat" nativeButton={false} render={<Link to="/c/$chatId" params={{ chatId }} />}>
          <ArrowLeftIcon />
        </Button>
        <h1 className="truncate font-medium">Group info</h1>
        <PlayerSlot />
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-4">
          {dialog === undefined ? (
            <ProfileSkeleton />
          ) : dialog.status === 'member' ? (
            <MemberView chatId={chatId} title={dialog.title} />
          ) : (
            <>
              <Profile title={dialog.title} subtitle={null} />
              <Alert role="status">
                <AlertDescription>You’re no longer a member of this group.</AlertDescription>
              </Alert>
              <div>
                <DeleteDialogButton chatId={chatId} title={dialog.title} />
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function Profile({ title, subtitle, action }: { title: string; subtitle: string | null; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <UserAvatar name={title} image={null} size="lg" />
      <div className="grid min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold">{title}</h2>
        {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
      </div>
      {action}
    </div>
  )
}

/** 与 Profile 同样的头像和两行文字 */
function ProfileSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton variant="avatar" className="size-10 shrink-0" />
      <div className="grid min-w-0 flex-1">
        <SkeletonText className="w-40 text-lg" />
        <SkeletonText className="w-20 text-sm" />
      </div>
    </div>
  )
}

function MemberView({ chatId, title }: { chatId: string; title: string }) {
  const me = useMe()
  const members = useLiveQuery<MemberRow>(MEMBERS_SQL, [chatId], [topics.members(chatId), topics.users])
  const [dialog, setDialog] = useState<'title' | 'add' | null>(null)
  const isOwner = members?.some((m) => m.user_id === me.id && m.role === 'owner') ?? false
  const count = members?.length ?? 0

  return (
    <>
      <Profile
        title={title}
        subtitle={members ? (count === 1 ? '1 member' : `${count} members`) : null}
        action={
          isOwner && (
            <Button variant="outline" size="sm" onClick={() => setDialog('title')}>
              <PencilIcon data-icon="inline-start" />
              Rename
            </Button>
          )
        }
      />

      <InviteLink chatId={chatId} isOwner={isOwner} title={title} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Members</h2>
          <Button variant="outline" size="sm" disabled={!members || count >= MAX_GROUP_MEMBERS} onClick={() => setDialog('add')}>
            <UserPlusIcon data-icon="inline-start" />
            Add members
          </Button>
        </div>
        <MembersTable chatId={chatId} members={members} isOwner={isOwner} />
      </section>

      <div>
        <LeaveButton chatId={chatId} title={title} members={members ?? []} isOwner={isOwner} />
      </div>

      <ResponsiveDialog
        open={dialog === 'title'}
        onOpenChange={(open) => setDialog(open ? 'title' : null)}
        title="Rename group"
        description="Everyone in the group will see the new name."
      >
        {(Footer) => <RenameForm chatId={chatId} title={title} Footer={Footer} onDone={() => setDialog(null)} />}
      </ResponsiveDialog>
      <ResponsiveDialog
        open={dialog === 'add'}
        onOpenChange={(open) => setDialog(open ? 'add' : null)}
        title="Add members"
        description="New members can see the whole chat history."
      >
        {(Footer) => (
          <AddMembersForm
            chatId={chatId}
            memberIds={members?.map((m) => m.user_id) ?? []}
            Footer={Footer}
            onDone={() => setDialog(null)}
          />
        )}
      </ResponsiveDialog>
    </>
  )
}

// ---------- 成员表 ----------

const features = tableFeatures({})
const column = createColumnHelper<typeof features, MemberRow>()

/** members 还没取到时显示同样表头、同样行高的占位 */
function MembersTable({ chatId, members, isOwner }: { chatId: string; members: MemberRow[] | undefined; isOwner: boolean }) {
  const me = useMe()
  // 每次移除一个新的 random_id；同一次移除的重试沿用它
  const [removing, setRemoving] = useState<{ member: MemberRow; rid: number } | null>(null)

  const columns = column.columns([
    column.accessor('name', {
      header: 'Name',
      // 别人的名字点进资料页（加联系人、拉黑都在那里）
      cell: ({ row }) =>
        row.original.user_id === me.id ? (
          <div className="flex min-w-0 items-center gap-2">
            <UserAvatar name={row.original.name} image={row.original.image} size="sm" />
            <span className="truncate">You</span>
          </div>
        ) : (
          <Link to="/u/$userId" params={{ userId: row.original.user_id }} className="flex min-w-0 items-center gap-2">
            <UserAvatar name={row.original.name} image={row.original.image} size="sm" />
            <span className="truncate">{row.original.name ?? '…'}</span>
          </Link>
        ),
    }),
    column.accessor('role', {
      header: 'Role',
      cell: ({ getValue }) => (getValue() === 'owner' ? <Badge variant="secondary">Owner</Badge> : null),
    }),
    column.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      // 操作靠最右
      cell: ({ row }) =>
        isOwner && row.original.user_id !== me.id ? (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Member actions" />}>
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onClick={() => setRemoving({ member: row.original, rid: randomId() })}>
                  <UserMinusIcon />
                  Remove from group
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null,
    }),
  ])

  const table = useTable({ features, columns, data: members ?? [], getRowId: (row) => row.user_id })

  return (
    <>
      {members ? (
        <DataTable table={table} />
      ) : (
        <DataTableSkeleton
          table={table}
          rows={2}
          cells={[
            <div key="name" className="flex items-center gap-2">
              <Skeleton variant="avatar" className="size-6 shrink-0" />
              <SkeletonText className="w-24 text-sm" />
            </div>,
          ]}
        />
      )}
      <RemoveMemberDialog chatId={chatId} target={removing} onClose={() => setRemoving(null)} />
    </>
  )
}

function RemoveMemberDialog({
  chatId,
  target,
  onClose,
}: {
  chatId: string
  target: { member: MemberRow; rid: number } | null
  onClose: () => void
}) {
  const [pending, setPending] = useState(false)
  const member = target?.member

  const remove = async () => {
    if (!target) return
    setPending(true)
    try {
      await call('removeMember', { chatId, randomId: target.rid, userId: target.member.user_id })
      onClose()
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't remove this member", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {member?.name ?? 'this member'}?</AlertDialogTitle>
          <AlertDialogDescription>
            They’ll keep the history up to now but won’t see new messages. Anyone in the group can add them back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={() => void remove()}>
            {pending && <Spinner data-icon="inline-start" />}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------- 退出 ----------

function LeaveButton({ chatId, title, members, isOwner }: { chatId: string; title: string; members: MemberRow[]; isOwner: boolean }) {
  const me = useMe()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [rid] = useState(randomId)
  // 与服务端一致：群主身份转给最早入群的成员
  const heir = isOwner ? members.find((m) => m.user_id !== me.id) : undefined

  const leave = async () => {
    setPending(true)
    try {
      await call('leaveChat', { chatId, randomId: rid })
      setOpen(false)
      await navigate({ to: '/c/$chatId', params: { chatId } })
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't leave the group", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        <LogOutIcon data-icon="inline-start" />
        Leave group
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave “{title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            You’ll keep the history up to now but won’t see new messages.
            {heir && ` ${heir.name ?? 'The next member'} will become the owner.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={() => void leave()}>
            {pending && <Spinner data-icon="inline-start" />}
            Leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------- 表单 ----------

const titleSchema = v.object({
  title: v.pipe(
    v.string(),
    v.trim(),
    v.nonEmpty('Enter a group name.'),
    v.maxLength(MAX_TITLE_LENGTH, `Use ${MAX_TITLE_LENGTH} characters or fewer.`),
  ),
})

function RenameForm({ chatId, title, Footer, onDone }: { chatId: string; title: string; Footer: DialogFooterComponent; onDone: () => void }) {
  const [rid] = useState(randomId)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { title },
    validators: { onSubmit: titleSchema },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      try {
        await call('editTitle', { chatId, randomId: rid, title: value.title.trim() })
        onDone()
      } catch (e) {
        setSubmitError(opErrorMessage(e, "Couldn't rename the group. Try again."))
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
              const errors = [...field.state.meta.errors, ...(submitError ? [{ message: submitError }] : [])]
              const invalid = errors.length > 0
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="rename-title">Group name</FieldLabel>
                  <Input
                    id="rename-title"
                    name={field.name}
                    autoComplete="off"
                    autoFocus
                    maxLength={MAX_TITLE_LENGTH}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={invalid}
                  />
                  <FieldError errors={errors} />
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
              Save
            </Button>
          </Footer>
        )}
      </form.Subscribe>
    </form>
  )
}

const addSchema = v.object({
  members: v.pipe(v.array(v.custom<UserProfile>(() => true)), v.minLength(1, 'Add at least one member.')),
})

function AddMembersForm({
  chatId,
  memberIds,
  Footer,
  onDone,
}: {
  chatId: string
  memberIds: string[]
  Footer: DialogFooterComponent
  onDone: () => void
}) {
  const [rid] = useState(randomId)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { members: [] as UserProfile[] },
    validators: { onSubmit: addSchema },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      try {
        await call('addMembers', { chatId, randomId: rid, userIds: value.members.map((u) => u.id) })
        onDone()
      } catch (e) {
        setSubmitError(membersErrorMessage(e, value.members, "Couldn't add members. Try again."))
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
          <form.Field name="members">
            {(field) => (
              <MemberPicker
                id="add-members"
                value={field.state.value}
                onChange={field.handleChange}
                excludeIds={memberIds}
                max={MAX_GROUP_MEMBERS - memberIds.length}
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
              Add
            </Button>
          </Footer>
        )}
      </form.Subscribe>
    </form>
  )
}
