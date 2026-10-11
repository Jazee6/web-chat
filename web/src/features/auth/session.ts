// 登录状态：本地优先，后台校验。见 docs/architecture/06-auth-and-security.md
import { createAuthClient } from 'better-auth/client'
import { clearMediaCache } from '@/features/media/cache'
import { clearBadge } from '@/features/notifications/badge'
import { releasePush, resetPushOnDevice } from '@/features/notifications/push'
import { clearShare } from '@/features/share/stash'
import { call, onWiped } from '@/sync/client'

const authClient = createAuthClient()

const PROVIDER_ID = 'idp'
const ME_KEY = 'web-chat:me'
/** 本设备在其他设备上被移除：不自动跳转 IdP（IdP 会话还在时会静默重新登录），先告知用户 */
const REMOVED_KEY = 'web-chat:removed'

export type Me = { id: string; name: string; email: string; image: string | null }

export type Boot = { me: Me } | { me: null; reason: 'signed-out' | 'removed' | 'offline' }

function readMe(): Me | null {
  try {
    const raw = localStorage.getItem(ME_KEY)
    return raw ? (JSON.parse(raw) as Me) : null
  } catch {
    return null
  }
}

function writeMe(me: Me | null) {
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me))
    else localStorage.removeItem(ME_KEY)
  } catch {
    // 存储不可用时每次启动都走网络校验
  }
}

/** 本地库之外、属于本账号的本机状态：角标、favicon、通知与推送订阅、媒体缓存、还没发出的分享内容 */
async function clearDeviceState() {
  clearBadge()
  await Promise.all([
    resetPushOnDevice().catch(() => {}),
    clearMediaCache().catch(() => {}),
    clearShare().catch(() => {}),
  ])
}

function setRemoved(removed: boolean) {
  try {
    if (removed) localStorage.setItem(REMOVED_KEY, '1')
    else localStorage.removeItem(REMOVED_KEY)
  } catch {
    // 存储不可用：直接跳转 IdP
  }
}

function wasRemoved() {
  try {
    return localStorage.getItem(REMOVED_KEY) !== null
  } catch {
    return false
  }
}

/** 返回 null 表示明确未登录；网络错误时抛出 */
async function fetchMe(): Promise<Me | null> {
  const { data, error } = await authClient.getSession()
  if (error) throw new Error(error.message ?? 'get-session failed')
  if (!data) return null
  const { id, name, email, image } = data.user
  return { id, name, email, image: image ?? null }
}

/**
 * 启动：有缓存的身份就立即使用（离线秒开），同时在后台校验；
 * 没有缓存才等待 get-session。
 */
export async function bootstrap(): Promise<Boot> {
  // 退出登录、会话失效或本设备被移除后，本标签页重新走启动流程
  onWiped((reason) => {
    writeMe(null)
    if (reason === 'revoked') setRemoved(true)
    void clearDeviceState().then(() => location.reload())
  })

  const cached = readMe()
  if (cached) {
    void verify(cached)
    return { me: cached }
  }
  try {
    const me = await fetchMe()
    if (!me) return { me: null, reason: wasRemoved() ? 'removed' : 'signed-out' }
    setRemoved(false)
    writeMe(me)
    return { me }
  } catch {
    return { me: null, reason: 'offline' }
  }
}

async function verify(cached: Me) {
  let me: Me | null
  try {
    me = await fetchMe()
  } catch {
    return // 离线：继续使用本地数据
  }
  if (me?.id === cached.id) {
    writeMe(me) // 资料可能在 IdP 更新过
    return
  }
  // 已退出或换了账号：删除本地库后重新启动
  await call('wipe', {})
  writeMe(null)
  await clearDeviceState()
  location.reload()
}

/** 登录后回到当前页面（例如打开的邀请链接）；从登录错误页重试时回到首页 */
export function signIn() {
  setRemoved(false)
  const here = location.pathname === '/login' ? '/' : location.pathname + location.search
  return authClient.signIn.social({ provider: PROVIDER_ID, callbackURL: here, errorCallbackURL: '/login' })
}

/**
 * 退出登录的顺序很重要（跳转会终止 Worker）：
 * 先趁会话还有效删除发件箱里已上传、没发出去的媒体，并退掉本机的推送订阅，再在服务端结束会话并拿到 IdP 登出地址，
 * 然后删除本地库，最后跳转。
 */
export async function signOut() {
  // 同步 Worker 卡住时不能拖住退出登录：最多等 3 秒。删不掉的媒体留给孤儿清理；
  // 没退掉的订阅，服务端发现 session 已失效时不再推送并清除
  await Promise.race([
    Promise.all([call('releaseMedia', {}).catch(() => {}), releasePush().catch(() => {})]),
    new Promise((r) => setTimeout(r, 3000)),
  ])
  const { data, error } = await authClient.signOut({ disableRedirect: true })
  if (error) throw new Error(error.message ?? 'sign-out failed')
  await call('wipe', {})
  writeMe(null)
  await clearDeviceState()
  location.href = data?.url ?? '/'
}
