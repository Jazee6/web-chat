// 画中画：把一个会话弹成置顶小窗（Document Picture-in-Picture，目前只有 Chromium 桌面版支持）。
//
// 小窗里放一个同源 iframe，加载 /pip/{chatId}，而不是把 React 子树直接渲染进小窗：
// 弹层（菜单、确认框、提示）默认挂到当前 document 的 body，可见性、选区也都按当前 document 算，
// iframe 有自己的 document，这些自然都在小窗里。它像一个 Follower 标签页一样经 Leader 读写本地库，
// 可见时上报可见，设备因此算作在前台（见 CONTEXT.md「画中画」）

type DocumentPictureInPicture = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>
}

/** 小窗调用它回到主窗口（挂在小窗的 window 上，由 iframe 经 parent 调用） */
type PipHost = Window & { returnToApp?: () => void }

const WIDTH = 380
const HEIGHT = 560

let pip: { window: Window; frame: HTMLIFrameElement } | null = null

/** 只能由顶层窗口打开；小窗里的页面本身在 iframe 中，不显示入口 */
export const pipSupported = 'documentPictureInPicture' in window && window.top === window

/** 本页是不是小窗里的 iframe */
export const inPip = window.top !== window && location.pathname.startsWith('/pip/')

const pipUrl = (chatId: string) => new URL(`/pip/${encodeURIComponent(chatId)}`, location.origin).href

/** 打开小窗；已经开着时换成这个会话。必须在用户操作中调用 */
export async function openPip(chatId: string) {
  if (pip && !pip.window.closed) {
    pip.frame.src = pipUrl(chatId)
    return
  }
  const api = (window as unknown as { documentPictureInPicture: DocumentPictureInPicture }).documentPictureInPicture
  const win = await api.requestWindow({ width: WIDTH, height: HEIGHT })
  const doc = win.document
  doc.title = document.title
  doc.body.style.margin = '0'
  const frame = doc.createElement('iframe')
  frame.src = pipUrl(chatId)
  frame.title = 'Chat'
  // 小窗里也能录语音消息
  frame.allow = 'microphone'
  frame.style.cssText = 'display:block;width:100vw;height:100vh;border:0'
  doc.body.append(frame)
  ;(win as PipHost).returnToApp = () => window.focus()
  win.addEventListener('pagehide', () => {
    if (pip?.window === win) pip = null
  })
  pip = { window: win, frame }
}

/** 从小窗回到主窗口：浏览器可能不允许抢焦点，这时用户可以用小窗自带的返回按钮 */
export function returnToApp() {
  ;(window.parent as PipHost).returnToApp?.()
}
