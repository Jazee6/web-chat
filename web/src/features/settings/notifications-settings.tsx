import { useState } from 'react'
import { DEFAULT_SETTINGS } from 'shared/protocol'

import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { opErrorMessage } from '@/features/groups/errors'
import { disablePush, enablePush, usePushState, type PushState } from '@/features/notifications/push'
import { topics } from '@/sync/bridge'
import { call } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'
import { FieldSkeleton } from './field-skeleton'

const DEVICE_DESCRIPTIONS: Record<PushState, string> = {
  on: 'Show a notification for new messages when Chat isn’t open.',
  off: 'Show a notification for new messages when Chat isn’t open.',
  denied: 'Notifications are blocked. Allow them in your browser’s site settings.',
  install: 'Add Chat to your Home Screen to get notifications.',
  unsupported: 'This browser doesn’t support notifications.',
}

const PREVIEW_SQL = "SELECT json_extract(value, '$.notification_preview') AS preview FROM kv WHERE key = 'settings'"

/** 通知：本机推送开关（按设备）与通知预览（账号设置，多设备同步）。开关即时生效 */
export function NotificationsSettings() {
  const rows = useLiveQuery<{ preview: number | null }>(PREVIEW_SQL, [], [topics.settings])
  if (rows === undefined) {
    return (
      <div className="px-4 pb-4 md:p-0">
        <FieldGroup>
          <FieldSkeleton lines={1}>
            <Skeleton variant="control" className="h-[18.4px] w-8" />
          </FieldSkeleton>
          <FieldSkeleton lines={2}>
            <Skeleton variant="control" className="h-[18.4px] w-8" />
          </FieldSkeleton>
        </FieldGroup>
      </div>
    )
  }
  // 本地库里的设置可能是加这一项之前同步的：没有时取默认值
  const stored = rows[0]?.preview ?? null
  const preview = stored === null ? DEFAULT_SETTINGS.notification_preview : stored === 1
  return (
    <div className="px-4 pb-4 md:p-0">
      <FieldGroup>
        <DevicePushField />
        <PreviewField preview={preview} />
      </FieldGroup>
    </div>
  )
}

function DevicePushField() {
  const state = usePushState()
  const [busy, setBusy] = useState(false)

  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      if (!on) await disablePush()
      else if (!(await enablePush())) toast.add({ title: 'Notifications weren’t allowed', description: DEVICE_DESCRIPTIONS.denied })
    } catch {
      toast.add({ type: 'error', title: on ? "Couldn't turn on notifications" : "Couldn't turn off notifications" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Field orientation="horizontal" data-disabled={state === 'on' || state === 'off' ? undefined : true}>
      <FieldContent>
        <FieldLabel htmlFor="push-device">Notifications on this device</FieldLabel>
        <FieldDescription>{DEVICE_DESCRIPTIONS[state]}</FieldDescription>
      </FieldContent>
      <Switch
        id="push-device"
        checked={state === 'on'}
        disabled={busy || (state !== 'on' && state !== 'off')}
        onCheckedChange={(on) => void toggle(on)}
      />
    </Field>
  )
}

function PreviewField({ preview }: { preview: boolean }) {
  const [pending, setPending] = useState<boolean | null>(null)

  const toggle = async (on: boolean) => {
    setPending(on)
    try {
      await call('setSettings', { settings: { notification_preview: on } })
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't save your settings", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setPending(null)
    }
  }

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="push-preview">Message preview</FieldLabel>
        <FieldDescription>Show message text in notifications. When off, they only show who sent a message.</FieldDescription>
      </FieldContent>
      <Switch
        id="push-preview"
        checked={pending ?? preview}
        disabled={pending !== null}
        onCheckedChange={(on) => void toggle(on)}
      />
    </Field>
  )
}
