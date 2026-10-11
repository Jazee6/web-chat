// 通话界面的麦克风与摄像头开关：开关旁边的箭头打开菜单，切换音视频设备与 AI 降噪（一对一与群组通话共用）。
// 选择存在本机偏好里，通话中的麦克风与摄像头跟着换
import { ChevronUpIcon, MicIcon, MicOffIcon, SwitchCameraIcon, VideoIcon, VideoOffIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Toggle } from '@/components/ui/toggle'
import {
  choose,
  selectedValue,
  speakerSupported,
  SYSTEM_DEFAULT,
  systemDefaultLabel,
  useAvDevices,
  type AvDeviceList,
} from '@/features/av/devices'
import { aiNoiseSupported } from '@/features/av/noise'
import { setAvPreference, useAvPreferences, type AvKind } from '@/features/av/preferences'
import { useIsMobile } from '@/hooks/use-mobile'
import { Tip } from './streams'

export function MicControl({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  const list = useAvDevices()
  const { aiNoise } = useAvPreferences()
  const speakers = speakerSupported && list.devices.speaker.length > 1
  const toggle = (
    <Tip label={on ? 'Mute' : 'Unmute'}>
      <Toggle variant="outline" size="lg" pressed={!on} disabled={disabled} onPressedChange={onToggle}>
        {on ? <MicIcon /> : <MicOffIcon />}
      </Toggle>
    </Tip>
  )
  if (!list.access.mic && !speakers && !aiNoiseSupported) return toggle
  return (
    <ButtonGroup>
      {toggle}
      <DropdownMenu>
        <Tip label="Audio settings">
          <DropdownMenuTrigger render={<Button variant="outline" size="icon-lg" />}>
            <ChevronUpIcon />
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent side="top" align="center" className="w-72">
          {list.access.mic && <DeviceGroup kind="mic" title="Microphone" list={list} />}
          {speakers && (
            <>
              {list.access.mic && <DropdownMenuSeparator />}
              <DeviceGroup kind="speaker" title="Speaker" list={list} />
            </>
          )}
          {aiNoiseSupported && (
            <>
              {(list.access.mic || speakers) && <DropdownMenuSeparator />}
              <DropdownMenuCheckboxItem checked={aiNoise} onCheckedChange={(checked) => setAvPreference({ aiNoise: checked })}>
                AI noise suppression
              </DropdownMenuCheckboxItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}

/** 摄像头开关；手机上开着摄像头时另有前后翻转 */
export function CameraControl({
  on,
  disabled,
  onToggle,
  onFlip,
}: {
  on: boolean
  disabled?: boolean
  onToggle: () => void
  onFlip: () => void
}) {
  const list = useAvDevices()
  const isMobile = useIsMobile()
  const toggle = (
    <Tip label={on ? 'Turn off camera' : 'Turn on camera'}>
      <Toggle variant="outline" size="lg" pressed={on} disabled={disabled} onPressedChange={onToggle}>
        {on ? <VideoIcon /> : <VideoOffIcon />}
      </Toggle>
    </Tip>
  )
  const flip = isMobile && on && list.devices.camera.length > 1 && (
    <Tip label="Switch camera">
      <Button variant="outline" size="icon-lg" onClick={onFlip}>
        <SwitchCameraIcon />
      </Button>
    </Tip>
  )
  // 没授权过摄像头时看不到名字，不给菜单
  if (!list.access.camera) {
    return (
      <>
        {toggle}
        {flip}
      </>
    )
  }
  return (
    <>
      <ButtonGroup>
        {toggle}
        <DropdownMenu>
          <Tip label="Camera settings">
            <DropdownMenuTrigger render={<Button variant="outline" size="icon-lg" />}>
              <ChevronUpIcon />
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent side="top" align="center" className="w-72">
            <DeviceGroup kind="camera" title="Camera" list={list} />
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      {flip}
    </>
  )
}

function DeviceGroup({ kind, title, list }: { kind: AvKind; title: string; list: AvDeviceList }) {
  const chosen = useAvPreferences()[kind]
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{title}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={selectedValue(list, kind, chosen)} onValueChange={(value: string) => choose(kind, value)}>
        <DropdownMenuRadioItem value={SYSTEM_DEFAULT}>{systemDefaultLabel(list, kind)}</DropdownMenuRadioItem>
        {list.devices[kind].map((device) => (
          <DropdownMenuRadioItem key={device.id} value={device.id}>
            {device.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  )
}
