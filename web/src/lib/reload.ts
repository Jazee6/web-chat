// 发布新版本后重载页面：服务端的协议版本变了、同步 Worker 与标签页不是同一次构建、懒加载的代码块已经不存在。
// 通话、录音、上传进行中时推迟到结束之后。见 docs/adr/0013-forward-only-migrations-after-1-0.md
import { BUILD } from './build'

/** 上一次因为版本过旧重载前的构建：重载后还是同一个构建，说明没有拿到新版本，不再重载，免得无限刷新 */
const RELOADED_FROM = 'reloaded-from-build'
/** 等新的 Service Worker 检查更新的上限，超时照样重载（导航本来就是网络优先） */
const SW_UPDATE_TIMEOUT_MS = 5000
const BUSY_POLL_MS = 1000

const blockers = new Set<() => boolean>()
let requested = false

/** 登记一个推迟重载的条件（通话中、录音中、上传中……），返回注销函数 */
export function blockReload(busy: () => boolean): () => void {
  blockers.add(busy)
  return () => {
    blockers.delete(busy)
  }
}

/** 请求重载：没有进行中的通话、录音与上传时立即重载，否则等它们结束。重复请求只算一次 */
export function requestReload() {
  if (requested) return
  if (sessionStorage.getItem(RELOADED_FROM) === String(BUILD)) {
    console.error('reloaded but still on the same build', BUILD)
    return
  }
  requested = true
  const attempt = () => {
    if ([...blockers].some((busy) => busy())) return
    clearInterval(timer)
    void reload()
  }
  const timer = setInterval(attempt, BUSY_POLL_MS)
  attempt()
}

async function reload() {
  sessionStorage.setItem(RELOADED_FROM, String(BUILD))
  const registration = await navigator.serviceWorker?.getRegistration()
  await Promise.race([registration?.update().catch(() => {}), new Promise((resolve) => setTimeout(resolve, SW_UPDATE_TIMEOUT_MS))])
  location.reload()
}
