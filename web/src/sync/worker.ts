// 同步 Worker 入口：只在 Leader 标签页中运行。持有本地库（SQLite + OPFS）与唯一的 WebSocket，
// 通过 BroadcastChannel 为所有标签页服务。见 docs/architecture/07-client.md
import sqlite3InitModule, { type Database, type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { PROTOCOL_PARAM, PROTOCOL_VERSION } from 'shared/protocol'
import { sweepBlobs, wipeBlobs } from './blobs'
import {
  CHANNEL,
  type InitMessage,
  type Op,
  type OpError,
  type LeaderMessage,
  type TabMessage,
  type WorkerMessage,
} from './bridge'
import { BUILD } from '@/lib/build'
import { Connection, OfflineError } from './connection'
import { Engine, OpFailure } from './engine'
import { Store, intact, migrate } from './store'

const POOL_DIRECTORY = '/web-chat'
/** 上一任 Leader 的 Worker 可能还没释放 OPFS 句柄，安装 VFS 时带退避重试 */
const POOL_INSTALL_ATTEMPTS = 8

const channel = new BroadcastChannel(CHANNEL)
const queue: TabMessage[] = []
let runtime: { pool: SAHPoolUtil; db: Database; conn: Connection; engine: Engine } | null = null
let wiped = false
let restarting = false

function post(message: WorkerMessage) {
  channel.postMessage(message)
}

channel.onmessage = (e: MessageEvent<TabMessage | WorkerMessage>) => {
  const message = e.data
  if (message.k !== 'call' || wiped) return
  // 新旧版本的标签页同时开着：不处理另一个构建的请求，请较旧的一方重载。
  // 本 Worker 较旧时照样为同一构建的标签页服务，直到它们重载（通话中的标签页要等通话结束）
  if (message.build !== BUILD) {
    post({ k: 'outdated', newest: Math.max(message.build, BUILD) })
    return
  }
  if (runtime) void handle(message)
  else queue.push(message)
}

addEventListener('message', (e: MessageEvent<InitMessage>) => {
  if (e.data.k === 'init') void start(e.data.userId)
})

// 出错时检查本地库还在不在：浏览器可能在运行中清掉 OPFS（实测在无痕式上下文里闲置后发生），
// 之后每次写入都会失败，连接却仍然在线，收到的更新全部丢掉
addEventListener('error', checkIntact)
addEventListener('unhandledrejection', checkIntact)

/**
 * 本地库丢失时：断开连接、关闭本地库，请 Leader 标签页换一个新的 Worker。
 * 新 Worker 像首次登录一样建库并全量同步，就绪后广播 ready，各标签页重放请求并重新告知状态；
 * 发件箱随本地库一起丢失。期间收到的请求不再处理，由标签页在 ready 后重放
 */
function checkIntact() {
  if (!runtime || wiped || restarting || intact(runtime.db)) return
  restarting = true
  const { conn, db } = runtime
  runtime = null
  conn.stop()
  try {
    db.close()
  } catch {
    // 文件已经不在
  }
  postMessage({ k: 'restart' } satisfies LeaderMessage)
}

async function start(userId: string) {
  const sqlite3 = await sqlite3InitModule()
  const pool = await installPool(sqlite3)
  const file = `/u-${userId}.sqlite3`
  // 换了账号：删除其他用户的本地库
  for (const name of pool.getFileNames()) if (!name.startsWith(file)) pool.unlink(name)
  const db = new pool.OpfsSAHPoolDb(file)
  if (!migrate(db)) {
    // 更新的版本已经迁移过本地库：不碰它，请 Leader 标签页重载
    db.close()
    postMessage({ k: 'outdated' } satisfies LeaderMessage)
    return
  }

  const store = new Store(db, userId, (topics) => post({ k: 'changed', topics }))
  store.scheduleMuteExpiry()
  // 发件箱里已经没有的待上传文件（换了账号、表结构重建、入队前崩溃）
  await sweepBlobs(new Set(store.allOutbox().map((row) => row.random_id)))
  const url = new URL('/ws', location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set(PROTOCOL_PARAM, String(PROTOCOL_VERSION))
  const conn: Connection = new Connection(url.href, {
    onOpen: () => void engine.onOpen(),
    onUpdates: (updates) => engine.onUpdates(updates),
    onEvents: (events) => engine.onEvents(events),
    onStatus: (status) => post({ k: 'status', status }),
    onHandshakeFailures: () => void checkSession(),
    onRevoked: () => void revoked(),
    onOutdated: () => post({ k: 'outdated', newest: Infinity }),
  })
  const engine = new Engine(store, conn, userId, post)
  runtime = { pool, db, conn, engine }

  post({ k: 'ready', build: BUILD })
  for (const message of queue.splice(0)) void handle(message)
  conn.start()
}

async function installPool(sqlite3: Sqlite3Static): Promise<SAHPoolUtil> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs({ directory: POOL_DIRECTORY })
    } catch (e) {
      if (attempt + 1 >= POOL_INSTALL_ATTEMPTS) throw e
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt))
    }
  }
}

async function handle({ tab, id, op, args }: TabMessage) {
  try {
    const value = await run(op, args, tab)
    post({ k: 'result', tab, id, ok: true, value })
  } catch (e) {
    post({ k: 'result', tab, id, ok: false, error: toOpError(e), userIds: e instanceof OpFailure ? e.userIds : undefined })
    checkIntact()
  }
}

function run(op: Op, args: unknown, tab: string): unknown {
  const { engine, conn } = runtime!
  switch (op) {
    case 'query':
      return engine.query(args as never)
    case 'view':
      return engine.view(args as never, tab)
    case 'presence':
      return engine.presence(args as never, tab)
    case 'typing':
      return engine.typing(args as never)
    case 'markPlayed':
      return engine.markPlayed(args as never)
    case 'read':
      return engine.read(args as never)
    case 'loadOlder':
      return engine.loadOlder(args as never)
    case 'send':
      return engine.send(args as never)
    case 'retry':
      return engine.retry(args as never)
    case 'discard':
      return engine.discard(args as never)
    case 'releaseMedia':
      return engine.releaseMedia()
    case 'editMessage':
      return engine.editMessage(args as never)
    case 'recallMessage':
      return engine.recallMessage(args as never)
    case 'react':
      return engine.react(args as never)
    case 'startSecretChat':
      return engine.startSecretChat(args as never)
    case 'safetyCode':
      return engine.safetyCode(args as never)
    case 'forward':
      return engine.forward(args as never)
    case 'pinMessage':
      return engine.pinMessage(args as never)
    case 'unpinMessage':
      return engine.unpinMessage(args as never)
    case 'resolveUser':
      return engine.resolveUser(args as never)
    case 'loadUser':
      return engine.loadUser(args as never)
    case 'createGroup':
      return engine.createGroup(args as never)
    case 'addMembers':
      return engine.addMembers(args as never)
    case 'removeMember':
      return engine.removeMember(args as never)
    case 'leaveChat':
      return engine.leaveChat(args as never)
    case 'editTitle':
      return engine.editTitle(args as never)
    case 'getInvite':
      return engine.getInvite(args as never)
    case 'resetInvite':
      return engine.resetInvite(args as never)
    case 'checkInvite':
      return engine.checkInvite(args as never)
    case 'joinChat':
      return engine.joinChat(args as never)
    case 'setSettings':
      return engine.setSettings(args as never)
    case 'deleteDialog':
      return engine.deleteDialog(args as never)
    case 'updateDialog':
      return engine.updateDialog(args as never)
    case 'saveDraft':
      return engine.saveDraft(args as never)
    case 'setContact':
      return engine.setContact(args as never)
    case 'removeContact':
      return engine.removeContact(args as never)
    case 'addSticker':
      return engine.addSticker(args as never)
    case 'removeSticker':
      return engine.removeSticker(args as never)
    case 'block':
      return engine.block(args as never)
    case 'unblock':
      return engine.unblock(args as never)
    case 'listDevices':
      return engine.listDevices()
    case 'revokeDevice':
      return engine.revokeDevice(args as never)
    case 'revokeOtherDevices':
      return engine.revokeOtherDevices()
    case 'setPush':
      return engine.setPush(args as never)
    case 'startCall':
      return engine.startCall(args as never, tab)
    case 'acceptCall':
      return engine.acceptCall(args as never, tab)
    case 'endCall':
      return engine.endCall(args as never)
    case 'signal':
      return engine.signal(args as never)
    case 'claimCall':
      return engine.claimCall(args as never, tab)
    case 'callState':
      return engine.callState()
    case 'joinGroupCall':
      return engine.joinGroupCall(args as never)
    case 'leaveGroupCall':
      return engine.leaveGroupCall(args as never)
    case 'publishGroupCall':
      return engine.publishGroupCall(args as never)
    case 'unpublishGroupCall':
      return engine.unpublishGroupCall(args as never)
    case 'pullGroupCall':
      return engine.pullGroupCall(args as never)
    case 'answerGroupCall':
      return engine.answerGroupCall(args as never)
    case 'layerGroupCall':
      return engine.layerGroupCall(args as never)
    case 'muteGroupCall':
      return engine.muteGroupCall(args as never)
    case 'groupCallOf':
      return engine.groupCallOf(args as never)
    case 'status':
      return conn.currentStatus
    case 'wipe':
      return wipe(tab)
  }
}

/** 退出登录或会话失效：断开连接、删除本地库，然后通知所有标签页 */
async function wipe(by: string | null, reason?: 'revoked') {
  if (wiped || !runtime) return null
  wiped = true
  const { pool, db, conn } = runtime
  conn.stop()
  db.close()
  await pool.wipeFiles()
  await wipeBlobs()
  // 发起者自己负责跳转，其他标签页收到后重新加载
  post({ k: 'wiped', by, reason })
  return null
}

/**
 * 本设备已在其他设备上被移除：先清掉 cookie（session 已不存在，sign-out 只删 cookie，不会跳 IdP 登出），
 * 再删除本地库。顺序不能反：标签页收到 wiped 就会重新加载，cookie 缓存还在的话会再次连上并被关闭
 */
async function revoked() {
  try {
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  } catch {
    // 下次连上时仍会被关闭，届时再试
  }
  await wipe(null, 'revoked')
}

/** 握手接连失败时确认登录状态：只有明确未登录才删除本地库，网络错误不算 */
async function checkSession() {
  try {
    const res = await fetch('/api/auth/get-session', { credentials: 'same-origin' })
    if (!res.ok) return
    if ((await res.json()) === null) await wipe(null)
  } catch {
    // 离线
  }
}

function toOpError(e: unknown): OpError {
  if (e instanceof OpFailure) return e.code
  if (e instanceof OfflineError) return 'offline'
  console.error(e)
  return 'internal'
}
