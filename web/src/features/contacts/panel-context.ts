import { createContext, use } from 'react'

export type Panel = 'chats' | 'contacts' | 'calls'

export const PanelContext = createContext<{ panel: Panel; setPanel: (panel: Panel) => void } | null>(null)

/** 侧栏当前显示的列表：对话、联系人或最近通话 */
export function useSidebarPanel() {
  const value = use(PanelContext)
  if (!value) throw new Error('useSidebarPanel must be used inside SidebarPanels')
  return value
}
