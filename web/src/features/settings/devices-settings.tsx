import { useEffect, useState, type ReactNode } from 'react'
import { CircleAlertIcon, LogOutIcon, MonitorIcon, SmartphoneIcon, WifiOffIcon } from 'lucide-react'
import type { DeviceInfo } from 'shared/protocol'

import type { DialogFooterComponent } from '@/components/responsive-dialog'
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
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { opErrorMessage } from '@/features/groups/errors'
import { formatDate, formatLastActive, locale } from '@/lib/format'
import { describeUserAgent, deviceName } from '@/lib/user-agent'
import { OpFailure, call, useConnectionStatus } from '@/sync/client'

const regions = new Intl.DisplayNames(locale, { type: 'region' })

type Removing = { kind: 'one'; device: DeviceInfo } | { kind: 'others' }

/** 设备管理：打开时拉取，移除后刷新；结果不进本地库，所以离线时不可用 */
export function DevicesSettings({ Footer }: { Footer: DialogFooterComponent }) {
  const status = useConnectionStatus()
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [removing, setRemoving] = useState<Removing | null>(null)

  const load = () =>
    call('listDevices', {}).then(setDevices, (e: unknown) => {
      // 离线由连接状态展示
      if (!(e instanceof OpFailure && e.code === 'offline')) setFailed(true)
    })

  useEffect(() => {
    if (status === 'online') void load()
  }, [status])

  if (devices === null) {
    if (status === 'offline') {
      return (
        <DevicesEmpty icon={<WifiOffIcon />} title="You’re offline" description="Connect to the internet to see your devices." />
      )
    }
    if (failed) {
      return (
        <DevicesEmpty
          icon={<CircleAlertIcon />}
          title="Couldn’t load your devices"
          description="Something went wrong. Try again."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setFailed(false)
                void load()
              }}
            >
              Try again
            </Button>
          }
        />
      )
    }
    return (
      <div className="px-4 pb-4 md:p-0">
        <ItemGroup>
          <DeviceSkeleton />
          <DeviceSkeleton removable />
        </ItemGroup>
      </div>
    )
  }

  const hasOthers = devices.some((d) => !d.current)
  return (
    <>
      <div className="px-4 pb-4 md:p-0">
        <ItemGroup>
          {devices.map((device) => (
            <DeviceItem key={device.id} device={device} onRemove={() => setRemoving({ kind: 'one', device })} />
          ))}
        </ItemGroup>
      </div>
      {hasOthers && (
        <Footer>
          <Button variant="destructive" onClick={() => setRemoving({ kind: 'others' })}>
            <LogOutIcon data-icon="inline-start" />
            Remove all other devices
          </Button>
        </Footer>
      )}
      <RemoveDeviceDialog target={removing} onClose={() => setRemoving(null)} onRemoved={() => void load()} />
    </>
  )
}

function DevicesEmpty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle role="heading" aria-level={2}>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

/** 与 DeviceItem 同样的图标、名字、两行说明；其他设备右边有移除按钮 */
function DeviceSkeleton({ removable = false }: { removable?: boolean }) {
  return (
    <Item variant="outline" size="sm">
      <ItemMedia variant="icon">
        <Skeleton className="size-4" />
      </ItemMedia>
      <ItemContent>
        <SkeletonText className="w-32 text-sm/snug" />
        <SkeletonText className="w-56 text-sm" />
        <SkeletonText className="w-40 text-sm" />
      </ItemContent>
      {removable && (
        <ItemActions>
          <Skeleton variant="control" className="h-8 w-20" />
        </ItemActions>
      )}
    </Item>
  )
}

function DeviceItem({ device, onRemove }: { device: DeviceInfo; onRemove: () => void }) {
  const ua = describeUserAgent(device.user_agent)
  const region = [device.city, device.country && regionName(device.country)].filter(Boolean).join(', ')
  const place = [region, device.ip].filter(Boolean).join(' · ')
  const activity = device.online ? 'Online' : formatLastActive(device.last_active)

  return (
    <Item variant="outline" size="sm" role="listitem">
      <ItemMedia variant="icon">{ua.mobile ? <SmartphoneIcon /> : <MonitorIcon />}</ItemMedia>
      <ItemContent>
        <ItemTitle>
          {deviceName(ua)}
          {device.current && <Badge variant="secondary">This device</Badge>}
        </ItemTitle>
        <ItemDescription>{place ? `${activity} · ${place}` : activity}</ItemDescription>
        <ItemDescription>Signed in {formatDate(device.created_at)}</ItemDescription>
      </ItemContent>
      {!device.current && (
        <ItemActions>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </ItemActions>
      )}
    </Item>
  )
}

function regionName(code: string) {
  try {
    return regions.of(code) ?? code
  } catch {
    return code
  }
}

function RemoveDeviceDialog({
  target,
  onClose,
  onRemoved,
}: {
  target: Removing | null
  onClose: () => void
  onRemoved: () => void
}) {
  const [pending, setPending] = useState(false)

  const remove = async () => {
    if (!target) return
    setPending(true)
    try {
      if (target.kind === 'one') await call('revokeDevice', { deviceId: target.device.id })
      else await call('revokeOtherDevices', {})
    } catch (e) {
      // 设备已经不在了（例如它自己退出了登录）：刷新列表即可
      if (!(e instanceof OpFailure && e.code === 'not_found')) {
        toast.add({ type: 'error', title: "Couldn't remove the device", description: opErrorMessage(e, 'Try again.') })
        setPending(false)
        return
      }
    }
    setPending(false)
    onClose()
    onRemoved()
  }

  const one = target?.kind === 'one' ? target.device : null
  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{one ? `Remove ${deviceName(describeUserAgent(one.user_agent))}?` : 'Remove all other devices?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {one
              ? 'It will be signed out and its local chats cleared. It can sign in again.'
              : 'Every device except this one will be signed out and its local chats cleared.'}
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
