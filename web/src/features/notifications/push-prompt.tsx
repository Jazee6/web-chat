import { BellIcon, XIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { dismissPushPrompt, enablePush, usePushPrompt } from './push'

/** 对话列表上方的常驻提示：开启本机通知。开启后或拒绝权限后自然消失，点叉不再提示 */
export function PushPrompt() {
  if (!usePushPrompt()) return null
  return (
    <div className="px-2">
      {/* 常驻的建议，不是要立刻处理的警告：不打断朗读 */}
      <Alert role="status">
        <BellIcon />
        <AlertTitle>Turn on notifications?</AlertTitle>
        <AlertDescription>
          <p>Get notified about new messages when Chat isn’t open.</p>
          <Button
            size="sm"
            onClick={() => enablePush().catch(() => toast.add({ type: 'error', title: "Couldn't turn on notifications" }))}
          >
            Turn on
          </Button>
        </AlertDescription>
        <AlertAction>
          <Button variant="ghost" size="icon-sm" aria-label="Not now" onClick={dismissPushPrompt}>
            <XIcon />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  )
}
