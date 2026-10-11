// 标签页侧：Leader 选举，以及经 BroadcastChannel 调用同步 Worker。
// 见 docs/architecture/07-client.md § 线程模型
import { useSyncExternalStore } from 'react'
import { PRESENCE_RENEW_MS, type PushSubscriptionKeys } from 'shared/protocol'
import {
  CHANNEL,
  LEADER_LOCK,
  type ConnectionStatus,
  type InitMessage,
  type Op,
  type OpError,
  type Ops,
  type LeaderMessage,
  type TabMessage,
  type WorkerMessage,
} from './bridge'
import { BUILD } from '@/lib/build'
import { requestReload } from '@/lib/reload'
import { applyPresence, applyTyping, applyUpload } from './transient'
import type { Call, GroupCall } from 'shared/protocol'

export class OpFailure extends Error {
  readonly code: OpError
  /** 与错误有关的用户（blocked 时为拉黑了自己的人） */
  readonly userIds: string[] | undefined

  constructor(code: OpError, userIds?: string[]) {
    super(code)
    this.code = code
    this.userIds = userIds
  }
}

const tabId = crypto.randomUUID()
const channel = new BroadcastChannel(CHANNEL)
let nextId = 1
const pending = new Map<number, { message: TabMessage; resolve: (value: never) => void; reject: (e: Error) => void }>()
const topicListeners = new Set<{ topics: Set<string>; notify: () => void }>()
const wipedListeners = new Set<(reason?: 'revoked') => void>()
const readyListeners = new Set<() => void>()
const callListeners = new Set<(call: Call | null, tab: string | null) => void>()
const signalListeners = new Set<(callId: string, data: string) => void>()
const groupCallListeners = new Set<(chatId: string, call: GroupCall | null, mine: boolean) => void>()

/** 本标签页正在查看的会话：新 Leader 接任时重新告知 */
let viewing: string | null = null
/** 本机的推送订阅：新 Leader 接任时重新告知；undefined 表示本标签页还没取得 */
let push: PushSubscriptionKeys | null | undefined

let status: ConnectionStatus = 'connecting'
const statusListeners = new Set<() => void>()

channel.onmessage = (e: MessageEvent<TabMessage | WorkerMessage>) => {
  const message = e.data
  switch (message.k) {
    case 'result': {
      if (message.tab !== tabId) return
      const call = pending.get(message.id)
      if (!call) return
      pending.delete(message.id)
      if (message.ok) call.resolve(message.value as never)
      else call.reject(new OpFailure(message.error, message.userIds))
      return
    }
    case 'changed':
      for (const listener of topicListeners) {
        if (message.topics.some((topic) => listener.topics.has(topic))) listener.notify()
      }
      return
    case 'status':
      setStatus(message.status)
      return
    case 'outdated':
      if (BUILD < message.newest) requestReload()
      return
    case 'ready':
      // 同步 Worker 是更新的版本：本标签页的请求它不会处理
      if (message.build > BUILD) requestReload()
      // 新 Leader 就绪：重放还没有结果的请求（请求均为幂等），重新告知本标签页的状态，刷新连接状态
      for (const call of pending.values()) channel.postMessage(call.message)
      reportVisibility()
      if (viewing) void call('view', { chatId: viewing })
      if (push !== undefined) call('setPush', { subscription: push }).catch(() => {})
      void call('status', {}).then(setStatus)
      for (const listener of readyListeners) listener()
      return
    case 'presence':
      applyPresence(message.users)
      return
    case 'typing':
      applyTyping(message.chat_id, message.user_id, message.action)
      return
    case 'upload':
      applyUpload(message.random_id, message.progress)
      return
    case 'call_state':
      for (const listener of callListeners) listener(message.call, message.tab)
      return
    case 'call_signal':
      if (message.tab === tabId) for (const listener of signalListeners) listener(message.call_id, message.data)
      return
    case 'group_call':
      for (const listener of groupCallListeners) listener(message.chat_id, message.call, message.mine)
      return
    case 'wiped':
      if (message.by !== tabId) for (const listener of wipedListeners) listener(message.reason)
      return
  }
}

export function call<O extends Op>(op: O, args: Ops[O]['args']): Promise<Ops[O]['result']> {
  const message: TabMessage = { k: 'call', tab: tabId, build: BUILD, id: nextId++, op, args }
  return new Promise((resolve, reject) => {
    pending.set(message.id, { message, resolve, reject })
    channel.postMessage(message)
  })
}

/** 标签页正在查看的会话；null 表示离开 */
export function setViewing(chatId: string | null) {
  viewing = chatId
  return call('view', { chatId })
}

/** 本机的推送订阅交给同步 Worker，由它在每次连接后上报；离线时 Worker 先记下，返回的 Promise 以 offline 失败 */
export function setPushSubscription(subscription: PushSubscriptionKeys | null) {
  push = subscription
  return call('setPush', { subscription })
}

function reportVisibility() {
  void call('presence', { visible: document.visibilityState === 'visible' })
}

/** 订阅本地库变更主题 */
export function onTopics(topics: string[], notify: () => void): () => void {
  const listener = { topics: new Set(topics), notify }
  topicListeners.add(listener)
  return () => topicListeners.delete(listener)
}

/** 新 Leader 就绪（同步 Worker 换了一个，它不知道各标签页的状态） */
export function onReady(listener: () => void): () => void {
  readyListeners.add(listener)
  return () => readyListeners.delete(listener)
}

/** 通话状态变化；tab 为通话所在的标签页 */
export function onCall(listener: (call: Call | null, tab: string | null) => void): () => void {
  callListeners.add(listener)
  return () => callListeners.delete(listener)
}

/** 发给本标签页的通话信令 */
/** 群组通话的变化 */
export function onGroupCall(listener: (chatId: string, call: GroupCall | null, mine: boolean) => void): () => void {
  groupCallListeners.add(listener)
  return () => groupCallListeners.delete(listener)
}

export function onCallSignal(listener: (callId: string, data: string) => void): () => void {
  signalListeners.add(listener)
  return () => signalListeners.delete(listener)
}

/** 其他标签页删除了本地库（退出登录、会话失效或本设备被移除） */
export function onWiped(listener: (reason?: 'revoked') => void): () => void {
  wipedListeners.add(listener)
  return () => wipedListeners.delete(listener)
}

let started = false

/**
 * 每个标签页都排队争夺 Leader 锁；拿到锁的标签页启动同步 Worker，并持有锁直到关闭。
 * 模块级幂等，StrictMode 重复执行也只会排一次队。
 */
export function startLeaderElection(userId: string) {
  if (started) return
  started = true
  void navigator.locks.request(LEADER_LOCK, () => {
    const spawn = () => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'sync' })
      // 本地库在运行中丢失：终止它（释放 OPFS 句柄），换一个新的 Worker；本地库已被更新的版本迁移过：重载
      worker.addEventListener('message', (e: MessageEvent<LeaderMessage>) => {
        if (e.data.k === 'outdated') {
          requestReload()
          return
        }
        worker.terminate()
        spawn()
      })
      worker.postMessage({ k: 'init', userId } satisfies InitMessage)
    }
    spawn()
    return new Promise<never>(() => {})
  })
  void call('status', {}).then(setStatus)

  // 可见性：变化时上报，可见期间定期上报（同步 Worker 据此判断标签页还活着），关闭时报不可见
  document.addEventListener('visibilitychange', reportVisibility)
  addEventListener('pagehide', () => void call('presence', { visible: false }))
  setInterval(() => {
    if (document.visibilityState === 'visible') reportVisibility()
  }, PRESENCE_RENEW_MS)
  reportVisibility()
}

function setStatus(next: ConnectionStatus) {
  if (status === next) return
  status = next
  for (const listener of statusListeners) listener()
}

function subscribeStatus(listener: () => void) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(subscribeStatus, () => status)
}
