import { useEffect } from 'react'

const APP_NAME = 'Web Chat'

/** 页面标题显示正在看的会话或用户：`名字 · Web Chat`；名字还没加载到或离开页面时为 Web Chat（index.html 的默认值） */
export function useDocumentTitle(name: string | null | undefined) {
  useEffect(() => {
    document.title = name ? `${name} · ${APP_NAME}` : APP_NAME
    return () => {
      document.title = APP_NAME
    }
  }, [name])
}
