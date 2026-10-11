// 通话界面共用的 hook
import { useEffect, useState } from 'react'
import { describeCall, formatDuration } from 'shared/text'

import { useMe } from '@/features/auth/me'
import { usePerson, useUserLookup } from '@/features/contacts/queries'
import { useGroupCall, type GroupView } from './group-session'
import { useCall, type CallView } from './session'

/** 对方的名字与头像：陌生人第一次打来时本地还没有他的资料，向服务端要 */
export function usePeer(peerId: string | null) {
  const person = usePerson(peerId ?? '')
  useUserLookup(peerId ?? '', peerId !== null && person !== undefined && person.name === null)
  return person
}

/** 通话的状态文字：响铃、连接、时长或结果 */
export function useCallStatus(view: CallView): string {
  const me = useMe()
  const now = useNow(view.phase === 'active')
  switch (view.phase) {
    case 'incoming':
      return 'Incoming call'
    case 'outgoing':
      return 'Ringing…'
    case 'connecting':
      return 'Connecting…'
    case 'active':
      return formatDuration((now - (view.connectedAt ?? now)) / 1000)
    case 'ended':
      if (view.error) return view.error
      if (!view.result) return 'Call ended'
      return describeCall(view.result, view.call?.caller_id === me.id, view.connectedAt && view.endedAt ? (view.endedAt - view.connectedAt) / 1000 : 0)
    case 'idle':
      return ''
  }
}

export function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

/** 通话界面收起后，头部用通话条代替播放条（见 CONTEXT.md「通话条」） */
export function useCallBar(): CallView | null {
  const view = useCall()
  return view.minimized && view.phase !== 'idle' && view.phase !== 'ended' ? view : null
}


/** 群组通话的时长：每个人都从发起时算，与通话记录一致（发起时间是服务端的时钟，偏差导致的负数按 0） */
export function groupCallDuration(view: GroupView, now: number): string {
  return formatDuration(Math.max(0, now - (view.call?.started_at ?? now)) / 1000)
}

/** 群组通话收起后的通话条 */
export function useGroupCallBar(): GroupView | null {
  const view = useGroupCall()
  return view.minimized && view.phase === 'active' ? view : null
}
