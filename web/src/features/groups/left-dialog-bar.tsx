import { useGroupDialog } from '@/features/chat/hooks'
import { fadeInOutMotion } from '@/lib/presence'
import { DeleteDialogButton } from './delete-dialog-button'

/** 只读对话的底栏：代替输入框 */
export function LeftDialogBar({ chatId }: { chatId: string }) {
  const dialog = useGroupDialog(chatId)
  return (
    <div ref={fadeInOutMotion} className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 p-3">
      <span className="text-sm text-muted-foreground">You’re no longer a member of this group.</span>
      {dialog && <DeleteDialogButton chatId={chatId} title={dialog.title} />}
    </div>
  )
}
