import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Link, useCanGoBack, useRouter } from '@tanstack/react-router'
import { ArrowLeftIcon, BanIcon, MessageCircleIcon, PencilIcon, UserMinusIcon, UserPlusIcon, UserXIcon } from 'lucide-react'
import { MAX_ALIAS_LENGTH, privateChatId } from 'shared/protocol'
import * as v from 'valibot'

import { ResponsiveDialog, type DialogFooterComponent } from '@/components/responsive-dialog'
import { SkeletonText } from '@/components/skeleton-text'
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { UserAvatar } from '@/components/user-avatar'
import { useMe } from '@/features/auth/me'
import { useViewChat } from '@/features/chat/hooks'
import { opErrorMessage } from '@/features/groups/errors'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { formatPresence } from '@/lib/format'
import { call } from '@/sync/client'
import { usePresence } from '@/sync/transient'
import { usePerson, useUserLookup, type Person } from './queries'
import { StartSecretChatButton } from '@/features/secret/start-secret-chat'
import { PlayerSlot } from '@/features/voice/player-bar'

/** 资料页：另一个用户的名字、备注名与在线状态，以及对他的操作 */
export function ProfilePage({ userId }: { userId: string }) {
  const me = useMe()
  const valid = userId !== me.id
  const chatId = privateChatId(me.id, userId)
  // 像打开私聊一样登记查看：据此拉取他的资料并观察在线状态
  useViewChat(chatId, valid)
  const { isMobile } = useSidebar()
  const person = usePerson(userId)
  const lookup = useUserLookup(userId, valid && person !== undefined && person.name === null)
  useDocumentTitle(valid ? person?.name : null)

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        {/* 手机上只留返回：左栏在这里只是个抽屉，和返回并排容易混淆 */}
        {!isMobile && <SidebarTrigger />}
        <BackButton chatId={chatId} />
        <h1 className="truncate font-medium">Profile</h1>
        <PlayerSlot />
      </header>
      {!valid ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserXIcon />
            </EmptyMedia>
            <EmptyTitle role="heading" aria-level={2}>That’s you</EmptyTitle>
            <EmptyDescription>Your own profile comes from your sign-in provider.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" nativeButton={false} render={<Link to="/" />}>
              Back to chats
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-4">
            {person !== undefined && person.name !== null ? (
              <Profile userId={userId} chatId={chatId} person={person} />
            ) : lookup === 'missing' ? (
              <ProfileEmpty title="User not found" description="This account doesn’t exist or was deleted." />
            ) : lookup === 'failed' ? (
              <ProfileEmpty title="Couldn’t load this profile" description="Try again in a moment." />
            ) : (
              <ProfileSkeleton />
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

/** 与 Profile 的布局一致：头像与两行文字，下面两组按钮。本地还没有这个人时才显示，所以按非联系人的按钮（加为联系人、拉黑） */
function ProfileSkeleton() {
  return (
    <>
      <div className="flex items-center gap-3">
        <Skeleton variant="avatar" className="size-10 shrink-0" />
        <div className="grid min-w-0 flex-1">
          <SkeletonText className="w-40 text-lg" />
          <SkeletonText className="w-28 text-sm" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Skeleton variant="control" className="h-9 sm:w-36" />
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Skeleton variant="control" className="h-9 sm:w-20" />
        </div>
      </div>
    </>
  )
}

function ProfileEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UserXIcon />
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={2}>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" nativeButton={false} render={<Link to="/" />}>
          Back to chats
        </Button>
      </EmptyContent>
    </Empty>
  )
}

/** 从哪里来回哪里去；直接打开的回到与他的私聊 */
function BackButton({ chatId }: { chatId: string }) {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  if (canGoBack) {
    return (
      <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => router.history.back()}>
        <ArrowLeftIcon />
      </Button>
    )
  }
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Back to chat" nativeButton={false} render={<Link to="/c/$chatId" params={{ chatId }} />}>
      <ArrowLeftIcon />
    </Button>
  )
}

function Profile({ userId, chatId, person }: { userId: string; chatId: string; person: Person }) {
  const presence = usePresence(userId)
  const [editing, setEditing] = useState(false)
  const aliased = person.alias !== null && person.alias !== person.own_name

  return (
    <>
      <div className="flex items-center gap-3">
        <UserAvatar name={person.name} image={person.image} size="lg" online={presence?.status === 'online'} />
        <div className="grid min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{person.name}</h2>
            {person.blocked && <Badge variant="secondary">Blocked</Badge>}
          </span>
          {aliased && <span className="truncate text-sm text-muted-foreground">{person.own_name}</span>}
          {presence && <span className="truncate text-sm text-muted-foreground">{formatPresence(presence)}</span>}
        </div>
      </div>

      {/* 常用操作与删除、拉黑分成两组；窄屏上每个按钮占满一行，不按宽度参差换行 */}
      <div className="flex flex-col gap-4">
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {person.contact && (
            <Button nativeButton={false} render={<Link to="/c/$chatId" params={{ chatId }} />}>
              <MessageCircleIcon data-icon="inline-start" />
              Send message
            </Button>
          )}
          {person.contact && !person.blocked && <StartSecretChatButton userId={userId} />}
          <Button variant="outline" onClick={() => setEditing(true)}>
            {person.contact ? <PencilIcon data-icon="inline-start" /> : <UserPlusIcon data-icon="inline-start" />}
            {person.contact ? 'Edit name' : 'Add to contacts'}
          </Button>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          {person.contact && <RemoveContactButton userId={userId} name={person.name ?? ''} />}
          <BlockButton userId={userId} name={person.name ?? ''} blocked={person.blocked} />
        </div>
      </div>

      <ResponsiveDialog
        open={editing}
        onOpenChange={setEditing}
        title={person.contact ? 'Edit name' : 'Add to contacts'}
        description={`Only you see the name you give ${person.own_name ?? 'them'}.`}
      >
        {(Footer) => <AliasForm userId={userId} person={person} Footer={Footer} onDone={() => setEditing(false)} />}
      </ResponsiveDialog>
    </>
  )
}

const aliasSchema = v.object({
  alias: v.pipe(v.string(), v.trim(), v.maxLength(MAX_ALIAS_LENGTH, `Use ${MAX_ALIAS_LENGTH} characters or fewer.`)),
})

/** 加为联系人或修改备注名；备注名留空表示用对方自己的名字 */
function AliasForm({
  userId,
  person,
  Footer,
  onDone,
}: {
  userId: string
  person: Person
  Footer: DialogFooterComponent
  onDone: () => void
}) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { alias: person.alias ?? '' },
    validators: { onSubmit: aliasSchema },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      try {
        await call('setContact', { userId, alias: value.alias.trim() || null })
        onDone()
      } catch (e) {
        setSubmitError(opErrorMessage(e, "Couldn't save. Try again."))
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
          <form.Field name="alias">
            {(field) => {
              const errors = [...field.state.meta.errors, ...(submitError ? [{ message: submitError }] : [])]
              const invalid = errors.length > 0
              return (
                <Field data-invalid={invalid}>
                  <FieldLabel htmlFor="contact-alias">Name</FieldLabel>
                  <Input
                    id="contact-alias"
                    name={field.name}
                    autoComplete="off"
                    autoFocus
                    maxLength={MAX_ALIAS_LENGTH}
                    placeholder={person.own_name ?? ''}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={invalid}
                  />
                  <FieldDescription>Leave it empty to use their own name.</FieldDescription>
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
              {person.contact ? 'Save' : 'Add'}
            </Button>
          </Footer>
        )}
      </form.Subscribe>
    </form>
  )
}

function RemoveContactButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const remove = async () => {
    setPending(true)
    try {
      await call('removeContact', { userId })
      setOpen(false)
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't remove this contact", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" />}>
        <UserMinusIcon data-icon="inline-start" />
        Remove contact
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name} from contacts?</AlertDialogTitle>
          <AlertDialogDescription>
            The name you gave them will be removed too. Your chat with them stays, and they won’t be told.
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

/** 拉黑要二次确认；解除拉黑直接生效 */
export function BlockButton({ userId, name, blocked }: { userId: string; name: string; blocked: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  const run = async (op: 'block' | 'unblock') => {
    setPending(true)
    try {
      await call(op, { userId })
      setOpen(false)
    } catch (e) {
      toast.add({
        type: 'error',
        title: op === 'block' ? "Couldn't block this person" : "Couldn't unblock this person",
        description: opErrorMessage(e, 'Try again.'),
      })
    } finally {
      setPending(false)
    }
  }

  if (blocked) {
    return (
      <Button variant="outline" disabled={pending} onClick={() => void run('unblock')}>
        {pending ? <Spinner data-icon="inline-start" /> : <BanIcon data-icon="inline-start" />}
        Unblock
      </Button>
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        <BanIcon data-icon="inline-start" />
        Block
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Block {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They won’t be able to message or call you, add you to groups, or see when you’re online. Groups you’re both in aren’t
            affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={() => void run('block')}>
            {pending && <Spinner data-icon="inline-start" />}
            Block
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
