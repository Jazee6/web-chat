import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Trash2Icon } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { call } from '@/sync/client'
import { opErrorMessage } from './errors'

/** 删除只读对话：所有设备同步移除 */
export function DeleteDialogButton({ chatId, title }: { chatId: string; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Trash2Icon data-icon="inline-start" />
        Delete chat
      </Button>
      <DeleteDialogAlert chatId={chatId} title={title} open={open} onOpenChange={setOpen} />
    </>
  )
}

/**
 * 删除只读对话或秘密聊天的确认框；正在查看这个会话（或它的群组信息）时，删除后回到对话列表。
 * 秘密聊天对双方生效：title 为对方的名字
 */
export function DeleteDialogAlert({
  chatId,
  title,
  secret = false,
  open,
  onOpenChange,
}: {
  chatId: string
  title: string
  secret?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { chatId: current } = useParams({ strict: false })
  const [deleting, setDeleting] = useState(false)

  const remove = async () => {
    setDeleting(true)
    try {
      await call('deleteDialog', { chatId })
      onOpenChange(false)
      if (current === chatId) await navigate({ to: '/' })
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't delete the chat", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{secret ? `Delete secret chat with ${title}?` : `Delete “${title}”?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {secret
              ? `The chat and its history will be deleted for both you and ${title}, on all devices. This can’t be undone.`
              : 'The chat and its history will be removed from all your devices.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={deleting} onClick={() => void remove()}>
            {deleting && <Spinner data-icon="inline-start" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
