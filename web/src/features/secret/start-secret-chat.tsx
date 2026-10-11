import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { LockIcon } from 'lucide-react'
import { newSecretChatId } from 'shared/protocol'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { useMe } from '@/features/auth/me'
import { opErrorMessage } from '@/features/groups/errors'
import { randomId } from '@/sync/logic'
import { call } from '@/sync/client'
import { useSecretChatWith } from './queries'

/** 资料页上的按钮：已经有秘密聊天时打开它，否则开始一个（只对联系人显示） */
export function StartSecretChatButton({ userId }: { userId: string }) {
  const me = useMe()
  const navigate = useNavigate()
  const existing = useSecretChatWith(userId)
  const [pending, setPending] = useState(false)

  if (existing === undefined) return null
  if (existing) {
    return (
      <Button variant="outline" nativeButton={false} render={<Link to="/c/$chatId" params={{ chatId: existing }} />}>
        <LockIcon data-icon="inline-start" />
        Open secret chat
      </Button>
    )
  }

  const start = async () => {
    setPending(true)
    try {
      const chatId = await call('startSecretChat', { userId, chatId: newSecretChatId(me.id, userId), randomId: randomId() })
      await navigate({ to: '/c/$chatId', params: { chatId } })
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't start a secret chat", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setPending(false)
    }
  }

  return (
    <Button variant="outline" disabled={pending} onClick={() => void start()}>
      {pending ? <Spinner data-icon="inline-start" /> : <LockIcon data-icon="inline-start" />}
      Start secret chat
    </Button>
  )
}
