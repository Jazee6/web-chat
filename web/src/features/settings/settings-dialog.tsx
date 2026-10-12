import { useState } from 'react'
import { ArrowLeftIcon, BellIcon, ChevronRightIcon, HardDriveIcon, HeadphonesIcon, LockIcon, MonitorSmartphoneIcon } from 'lucide-react'
import { DEFAULT_SETTINGS, type LastSeenPrivacy } from 'shared/protocol'

import type { DialogFooterComponent } from '@/components/responsive-dialog'
import { SkeletonText } from '@/components/skeleton-text'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { BlockedUsers } from '@/features/contacts/blocked-users'
import { opErrorMessage } from '@/features/groups/errors'
import { useIsMobile } from '@/hooks/use-mobile'
import { topics } from '@/sync/bridge'
import { call } from '@/sync/client'
import { useLiveQuery } from '@/sync/live-query'
import { AvSettings } from './av-settings'
import { DevicesSettings } from './devices-settings'
import { NotificationsSettings } from './notifications-settings'
import { StorageSettings } from './storage-settings'
import { FieldSkeleton } from './field-skeleton'

/** 设置分组 */
const SECTIONS = [
  { id: 'privacy', name: 'Privacy', icon: <LockIcon /> },
  { id: 'notifications', name: 'Notifications', icon: <BellIcon /> },
  { id: 'av', name: 'Audio & Video', icon: <HeadphonesIcon /> },
  { id: 'devices', name: 'Devices', icon: <MonitorSmartphoneIcon /> },
  { id: 'storage', name: 'Storage', icon: <HardDriveIcon /> },
] as const
type Section = (typeof SECTIONS)[number]['id']

function SectionContent({ section, Footer }: { section: Section; Footer: DialogFooterComponent }) {
  switch (section) {
    case 'privacy':
      return <PrivacySettings />
    case 'notifications':
      return <NotificationsSettings />
    case 'av':
      return <AvSettings />
    case 'devices':
      return <DevicesSettings Footer={Footer} />
    case 'storage':
      return <StorageSettings />
  }
}

/** 设置：桌面端为左侧分组导航的 Dialog；移动端为 Drawer，先列出分组，点进去再显示内容 */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const isMobile = useIsMobile()
  const [section, setSection] = useState<Section>('privacy')
  const [mobileSection, setMobileSection] = useState<Section | null>(null)
  const current = SECTIONS.find((s) => s.id === section)!

  if (isMobile) {
    const shown = SECTIONS.find((s) => s.id === mobileSection)
    return (
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next) setMobileSection(null)
          onOpenChange(next)
        }}
      >
        <DrawerContent>
          {/* Drawer 的头部与内容之间没有间距：与其他 Drawer 一样隔开 */}
          <div className="flex min-h-0 flex-1 flex-col gap-6">
            <DrawerHeader>
              {/* 标题与其他 Drawer 一样居中，两侧各留一个图标按钮的宽度 */}
              <div className="grid grid-cols-[2rem_1fr_2rem] items-center">
                <span>
                  {shown && (
                    <Button variant="ghost" size="icon-sm" aria-label="Back to settings" onClick={() => setMobileSection(null)}>
                      <ArrowLeftIcon />
                    </Button>
                  )}
                </span>
                <DrawerTitle>{shown?.name ?? 'Settings'}</DrawerTitle>
              </div>
              <DrawerDescription className="sr-only">Manage your account settings.</DrawerDescription>
            </DrawerHeader>
            {shown ? (
              <SectionContent section={shown.id} Footer={DrawerFooter} />
            ) : (
              <div className="px-4 pb-4">
                <ItemGroup>
                  {SECTIONS.map((item) => (
                    <Item
                      key={item.id}
                      variant="outline"
                      size="sm"
                      render={<button type="button" />}
                      onClick={() => setMobileSection(item.id)}
                    >
                      <ItemMedia variant="icon">{item.icon}</ItemMedia>
                      <ItemContent>
                        <ItemTitle>{item.name}</ItemTitle>
                      </ItemContent>
                      <ItemActions>
                        <ChevronRightIcon />
                      </ItemActions>
                    </Item>
                  ))}
                </ItemGroup>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="sidebar"
        onKeyDown={(e) => {
          // 两个 SidebarProvider 都在 window 上监听 ⌘/Ctrl+B 并写同一个 cookie；
          // 弹窗打开时拦下，免得切换背后的主侧边栏、改掉它记住的状态
          if (e.key === 'b' && (e.metaKey || e.ctrlKey)) e.stopPropagation()
        }}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Manage your account settings.</DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {SECTIONS.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton isActive={item.id === section} onClick={() => setSection(item.id)}>
                          {item.icon}
                          <span>{item.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[480px] flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center gap-2 px-4">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>Settings</BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{current.name}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </header>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
              <SectionContent section={section} Footer={DialogFooter} />
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

const SETTINGS_SQL = "SELECT json_extract(value, '$.last_seen') AS last_seen FROM kv WHERE key = 'settings'"

/** 隐私：最后上线时间（账号设置，多设备同步）与拉黑名单。与通知一样，选中即生效 */
function PrivacySettings() {
  const rows = useLiveQuery<{ last_seen: LastSeenPrivacy | null }>(SETTINGS_SQL, [], [topics.settings])
  if (rows === undefined) {
    return (
      <div className="flex flex-col gap-8 px-4 pb-4 md:p-0">
        <LastSeenSkeleton />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-8 px-4 pb-4 md:p-0">
      <LastSeenField lastSeen={rows[0]?.last_seen ?? DEFAULT_SETTINGS.last_seen} />
      <BlockedUsers />
    </div>
  )
}

const OPTIONS: { value: LastSeenPrivacy; title: string; description: string }[] = [
  {
    value: 'everyone',
    title: 'Everyone',
    description: 'People you chat with see when you’re online and exactly when you were last seen.',
  },
  {
    value: 'nobody',
    title: 'Nobody',
    description: 'Others only see an approximate time, like “recently”. You won’t see anyone else’s exact time either.',
  },
]

/** 与 LastSeenField 同样的标题、说明与两张选项卡片 */
function LastSeenSkeleton() {
  return (
    <FieldSet>
      <FieldLegend>
        <SkeletonText className="w-36" />
      </FieldLegend>
      {/* 紧跟标题的说明上移，与 FieldDescription 一致 */}
      <SkeletonText className="-mt-1.5 w-3/4 text-sm/normal" />
      {/* 与 RadioGroup 相同；FieldSet 在有 RadioGroup 时间距从 gap-6 收紧为 gap-3，这里没有，用负边距补上 */}
      <div className="-mt-3 grid w-full gap-3">
        {OPTIONS.map((option) => (
          <div key={option.value} className="rounded-xl border p-4">
            <FieldSkeleton lines={2}>
              <Skeleton variant="avatar" className="order-first mt-px size-4" />
            </FieldSkeleton>
          </div>
        ))}
      </div>
    </FieldSet>
  )
}

function LastSeenField({ lastSeen }: { lastSeen: LastSeenPrivacy }) {
  const [pending, setPending] = useState<LastSeenPrivacy | null>(null)

  const change = async (value: LastSeenPrivacy) => {
    setPending(value)
    try {
      await call('setSettings', { settings: { last_seen: value } })
    } catch (e) {
      toast.add({ type: 'error', title: "Couldn't save your settings", description: opErrorMessage(e, 'Try again.') })
    } finally {
      setPending(null)
    }
  }

  return (
    <FieldSet>
      <FieldLegend>Last seen & online</FieldLegend>
      <FieldDescription>Who can see when you were last online and whether you’re online now.</FieldDescription>
      <RadioGroup
        name="last_seen"
        value={pending ?? lastSeen}
        disabled={pending !== null}
        onValueChange={(value) => void change(value as LastSeenPrivacy)}
      >
        {OPTIONS.map((option) => (
          <FieldLabel key={option.value} htmlFor={`last-seen-${option.value}`}>
            <Field orientation="horizontal">
              <RadioGroupItem id={`last-seen-${option.value}`} value={option.value} />
              <FieldContent>
                <FieldTitle>{option.title}</FieldTitle>
                <FieldDescription>{option.description}</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
    </FieldSet>
  )
}
