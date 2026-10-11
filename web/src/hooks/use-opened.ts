import { useState } from 'react'

/** open 一旦为 true 就一直为 true：按需加载的弹窗第一次打开时才挂载，之后保留，关闭的动画照常播放 */
export function useOpened(open: boolean): boolean {
  const [opened, setOpened] = useState(open)
  if (open && !opened) setOpened(true)
  return opened || open
}
