// 标签页 ↔ 同步 Worker 的消息格式。
// 同步 Worker 直接监听 BroadcastChannel，为所有标签页（包括 Leader 自己）服务。
import type {
  Call,
  CallSlot,
  DeviceInfo,
  GroupCall,
  Draft,
  IceServer,
  InvitePreview,
  LinkPreview,
  MessageEntity,
  ReactionEmoji,
  PHOTO_MIME_TYPES,
  PREVIEW_MIME_TYPES,
  Presence,
  PulledTrack,
  PushSubscriptionKeys,
  SavedSticker,
  STICKER_MIME_TYPES,
  Settings,
  SimulcastRid,
  TypingAction,
  UserProfile,
  VOICE_MIME_TYPES,
} from 'shared/protocol'

export const CHANNEL = 'web-chat'
export const LEADER_LOCK = 'web-chat-leader'

export type Row = Record<string, unknown>

export type ConnectionStatus = 'connecting' | 'online' | 'offline'

/** 待发送的媒体：图片已在标签页压缩好，视频已转码并带着封面，文件保持原样，录音带着录音时算好的时长与波形 */
export type OutgoingMedia =
  | {
      type: 'photo'
      file: Blob
      mime: (typeof PHOTO_MIME_TYPES)[number]
      preview: Blob
      preview_mime: (typeof PREVIEW_MIME_TYPES)[number]
      w: number
      h: number
      thumbhash: string
    }
  | {
      type: 'video'
      file: Blob
      preview: Blob
      preview_mime: (typeof PREVIEW_MIME_TYPES)[number]
      w: number
      h: number
      duration: number
      thumbhash: string
    }
  | { type: 'file'; file: Blob; name: string; mime: string }
  | { type: 'voice'; file: Blob; mime: (typeof VOICE_MIME_TYPES)[number]; duration: number; waveform: string }

/** 链接预览卡片里不含图片的部分 */
export type PreparedPreview = { type: 'web'; title: string | null } | Extract<LinkPreview, { type: 'invite' }>

/**
 * 纯链接消息的卡片：ready 为标签页已经准备好的（图片已压缩），pending 表示还没抓到、由同步 Worker 在发送时抓取。
 * 不带卡片（不是纯链接，或用户在输入框里关掉了）时不传
 */
export type OutgoingLink =
  | { state: 'pending' }
  | {
      state: 'ready'
      preview: PreparedPreview
      photo?: { blob: Blob; mime: (typeof PREVIEW_MIME_TYPES)[number]; w: number; h: number; thumbhash: string }
    }

/** 一次发送里的一条消息：文本（可带提及与链接预览）、相册 / 文件消息 / 语音消息，或我的贴纸里的一张 */
export type OutgoingMessage =
  | { randomId: number; text: string; entities?: MessageEntity[]; link?: OutgoingLink }
  | { randomId: number; media: OutgoingMedia[] }
  | { randomId: number; sticker: SavedSticker }

/** 要添加到我的贴纸的图片：已在标签页处理好（见 features/stickers/prepare） */
export type PreparedSticker = { file: Blob; mime: (typeof STICKER_MIME_TYPES)[number]; w: number; h: number; thumbhash: string }

/** 标签页可调用的操作 */
export type Ops = {
  query: { args: { sql: string; params: unknown[] }; result: Row[] }
  /** 标签页当前查看的会话；打开时总是先 sync.chat */
  view: { args: { chatId: string | null }; result: null }
  /** 标签页可见性：变化时与可见期间定期上报，同步 Worker 汇总成设备状态 */
  presence: { args: { visible: boolean }; result: null }
  /** 正在输入：打字或录音（同步 Worker 按会话与动作节流） */
  typing: { args: { chatId: string; action: TypingAction }; result: null }
  /** 本设备播放过一条语音消息：只记在本地库 */
  markPlayed: { args: { chatId: string; seq: number }; result: null }
  /** 已读位置前移到 maxSeq：本地立即生效，由同步 Worker 按会话节流上报 */
  read: { args: { chatId: string; maxSeq: number }; result: null }
  /** 向上分页，limit 默认一页 50 条（最多 MAX_PAGE_LIMIT）；done 表示已到会话开头，或本地还没有这个会话 */
  loadOlder: { args: { chatId: string; limit?: number }; result: { done: boolean } }
  /**
   * 一次发送的所有消息（相册 → 文件 → 文字），按顺序入队、逐条发送；replyTo 只加在第一条上。
   * random_id 由标签页生成，Leader 交接时重放请求不会重复写入发件箱
   */
  send: { args: { chatId: string; replyTo?: number; messages: OutgoingMessage[] }; result: null }
  retry: { args: { randomId: number }; result: null }
  /** 放弃一条发送失败的消息，连同已上传的媒体一起删除 */
  discard: { args: { randomId: number }; result: null }
  /** 退出登录前：删除发件箱里已上传、还没发出去的媒体（之后会话失效就删不了了） */
  releaseMedia: { args: Record<string, never>; result: null }
  /** 编辑与撤回：必须在线，直接请求服务端 */
  editMessage: { args: { chatId: string; seq: number; text: string; entities?: MessageEntity[] }; result: null }
  recallMessage: { args: { chatId: string; seq: number }; result: null }
  /** 置顶与取消置顶消息：必须在线；random_id 由标签页生成，重放不会重复置顶 */
  pinMessage: { args: { chatId: string; seq: number; randomId: number }; result: null }
  unpinMessage: { args: { chatId: string; seq: number }; result: null }
  /** 转发一条消息到一个会话：必须在线；random_id 由标签页生成，重放不会重复转发 */
  forward: { args: { fromChatId: string; seq: number; toChatId: string; randomId: number }; result: null }
  /** 回应：emoji 为 null 表示取消自己的回应；必须在线 */
  react: { args: { chatId: string; seq: number; emoji: ReactionEmoji | null }; result: null }
  /**
   * 添加到我的贴纸：处理好的图片（上传后添加），或一条贴纸消息里的贴纸。必须在线，结果经 upd 推回所有设备
   */
  addSticker: { args: { sticker: PreparedSticker } | { chatId: string; seq: number }; result: null }
  /** 从我的贴纸里移除：必须在线 */
  removeSticker: { args: { key: string }; result: null }
  /** 开始秘密聊天，返回会话 ID（已经有了就是那个） */
  startSecretChat: { args: { userId: string; chatId: string; randomId: number }; result: string }
  /** 秘密聊天当前的安全码；本设备还没加入时为 null */
  safetyCode: { args: { chatId: string }; result: string[] | null }
  resolveUser: { args: { email: string }; result: UserProfile }
  /** 资料页：本地没有这个人时向服务端要，返回他是否存在；必须在线 */
  loadUser: { args: { userId: string }; result: boolean }
  /** 群组写操作：random_id 由标签页生成，重放不会重复执行 */
  createGroup: { args: { chatId: string; randomId: number; title: string; userIds: string[] }; result: null }
  addMembers: { args: { chatId: string; randomId: number; userIds: string[] }; result: null }
  removeMember: { args: { chatId: string; randomId: number; userId: string }; result: null }
  leaveChat: { args: { chatId: string; randomId: number }; result: null }
  editTitle: { args: { chatId: string; randomId: number; title: string }; result: null }
  /** 邀请链接：必须在线，结果不进本地库；返回邀请码 */
  getInvite: { args: { chatId: string }; result: string }
  resetInvite: { args: { chatId: string }; result: string }
  checkInvite: { args: { code: string }; result: InvitePreview }
  /** 凭邀请链接加入；random_id 由标签页生成，重放不会重复加入 */
  joinChat: { args: { code: string; randomId: number }; result: null }
  /** 修改账号设置：必须在线 */
  setSettings: { args: { settings: Partial<Settings> }; result: null }
  /** 删除只读对话 */
  deleteDialog: { args: { chatId: string }; result: null }
  /** 置顶与静音：必须在线，结果经 upd 推回所有设备 */
  updateDialog: { args: { chatId: string; pinned?: boolean; mutedUntil?: number }; result: null }
  /** 保存草稿：先写本地库，有变化时同步给服务端；离线时重连后再同步 */
  saveDraft: { args: { chatId: string; draft: Draft | null }; result: null }
  /** 联系人与拉黑：必须在线，结果经 upd 推回所有设备 */
  setContact: { args: { userId: string; alias: string | null }; result: null }
  removeContact: { args: { userId: string }; result: null }
  block: { args: { userId: string }; result: null }
  unblock: { args: { userId: string }; result: null }
  /** 设备管理：必须在线，结果不进本地库 */
  listDevices: { args: Record<string, never>; result: DeviceInfo[] }
  revokeDevice: { args: { deviceId: string }; result: null }
  revokeOtherDevices: { args: Record<string, never>; result: null }
  /**
   * 本机的推送订阅（null 表示不接收）。Dedicated Worker 里拿不到 PushManager，由标签页取得后告知；
   * 同步 Worker 记住它，每次连接后上报。离线时先记下，返回 offline
   */
  setPush: { args: { subscription: PushSubscriptionKeys | null }; result: null }
  /**
   * 一对一通话：必须在线。发起与接听的标签页成为通话所在的标签页，信令只转给它。
   * 发起时对方忙线返回已结束的通话，对方正好在呼叫我时返回对方的来电
   */
  startCall: { args: { chatId: string; callId: string }; result: { call: Call; iceServers: IceServer[] } }
  acceptCall: { args: { chatId: string; callId: string }; result: { call: Call; iceServers: IceServer[] } }
  endCall: { args: { chatId: string; callId: string }; result: null }
  /** 发给对方通话所在设备的信令；false 表示对方的设备暂时没连上 */
  signal: { args: { chatId: string; callId: string; data: string }; result: boolean }
  /** 新 Leader 就绪后，通话所在的标签页认领回来（新的同步 Worker 不知道是哪个标签页） */
  claimCall: { args: { callId: string }; result: null }
  /** 当前的通话与它所在的标签页；标签页打开或新 Leader 就绪时询问 */
  callState: { args: Record<string, never>; result: { call: Call | null; tab: string | null } }
  /**
   * 群组通话：必须在线。加入（没有进行中的就发起）的标签页持有到 SFU 的连接；
   * 发布、拉取等都是请求与返回，不需要转发信令。sdp 为压缩后的
   */
  joinGroupCall: { args: { chatId: string; callId: string }; result: { call: GroupCall; iceServers: IceServer[] } }
  leaveGroupCall: { args: { chatId: string; callId: string }; result: null }
  publishGroupCall: { args: { chatId: string; callId: string; sdp: string; tracks: { mid: string; slot: CallSlot }[] }; result: string }
  unpublishGroupCall: { args: { chatId: string; callId: string; sdp: string; slots: CallSlot[] }; result: string }
  pullGroupCall: {
    args: { chatId: string; callId: string; tracks: { user_id: string; slot: CallSlot; rid?: SimulcastRid }[] }
    result: { sdp: string | null; tracks: PulledTrack[] }
  }
  answerGroupCall: { args: { chatId: string; callId: string; sdp: string }; result: null }
  layerGroupCall: { args: { chatId: string; callId: string; mid: string; userId: string; rid: SimulcastRid }; result: null }
  muteGroupCall: { args: { chatId: string; callId: string; muted: boolean }; result: null }
  /** 同步 Worker 记得的群组通话（查看过的群组、自己参加的），横条挂载时询问 */
  groupCallOf: { args: { chatId: string }; result: { call: GroupCall | null; mine: boolean } }
  status: { args: Record<string, never>; result: ConnectionStatus }
  /** 断开连接并删除本地库 */
  wipe: { args: Record<string, never>; result: null }
}

export type Op = keyof Ops

/** 操作失败的原因：服务端错误码或本地原因 */
export type OpError =
  | 'offline'
  | 'not_found'
  | 'self_chat'
  | 'forbidden'
  | 'bad_request'
  | 'chat_full'
  | 'expired'
  | 'blocked'
  | 'pin_limit'
  /** 我的贴纸已满 */
  | 'sticker_limit'
  | 'busy'
  | 'call_ended'
  /** 秘密聊天：对方没有能加入的设备 */
  | 'no_keys'
  /** 秘密聊天：本设备还没加入，暂时不能发 */
  | 'not_ready'
  | 'internal'

/** build 为标签页的构建版本：与同步 Worker 不一致时不处理，较旧的一方重载 */
export type TabMessage = { k: 'call'; tab: string; build: number; id: number; op: Op; args: unknown }

export type WorkerMessage =
  | { k: 'result'; tab: string; id: number; ok: true; value: unknown }
  /** userIds：与错误有关的用户（blocked 时为拉黑了自己的人） */
  | { k: 'result'; tab: string; id: number; ok: false; error: OpError; userIds?: string[] }
  /** 本地库变更的主题，例如 dialogs、users、outbox、messages、chat:{id}、members:{id} */
  | { k: 'changed'; topics: string[] }
  | { k: 'status'; status: ConnectionStatus }
  /** 新 Leader 就绪：标签页重放尚未得到结果的请求；build 为同步 Worker 的构建版本 */
  | { k: 'ready'; build: number }
  /** 有更新的版本：构建早于 newest 的标签页重载。服务端拒绝了旧协议时 newest 为 Infinity */
  | { k: 'outdated'; newest: number }
  /** 瞬时状态，不进本地库：私聊对象的在线状态、正在输入（action 为 null 表示对方已发出消息） */
  | { k: 'presence'; users: { user_id: string; presence: Presence }[] }
  | { k: 'typing'; chat_id: string; user_id: string; action: TypingAction | null }
  /** 通话状态变化，tab 为通话所在的标签页（还没有时为 null）；call 为 null 表示通话在离线期间结束了 */
  | { k: 'call_state'; call: Call | null; tab: string | null }
  /** 通话另一端发来的信令，只有 tab 处理 */
  | { k: 'call_signal'; tab: string; call_id: string; data: string }
  /** 群组通话的变化（null 为已结束）；mine：自己参加着，并且就在这台设备上 */
  | { k: 'group_call'; chat_id: string; call: GroupCall | null; mine: boolean }
  /** 媒体消息的上传进度（0–1）；null 表示上传结束 */
  | { k: 'upload'; random_id: number; progress: number | null }
  /** 本地库已删除；by 为发起删除的标签页，reason 为 revoked 表示本设备在其他设备上被移除 */
  | { k: 'wiped'; by: string | null; reason?: 'revoked' }

/** Leader 标签页启动 Worker 后发送的第一条消息 */
export type InitMessage = { k: 'init'; userId: string }

/**
 * 同步 Worker 发给 Leader 标签页。restart：本地库在运行中丢失，换一个新的 Worker 从空库重新同步；
 * outdated：本地库已被更新的版本迁移过，重载页面
 */
export type LeaderMessage = { k: 'restart' } | { k: 'outdated' }

export const topics = {
  dialogs: 'dialogs',
  /** 用户资料与关系（联系人、备注名、拉黑） */
  users: 'users',
  outbox: 'outbox',
  settings: 'settings',
  /** 最近通话 */
  calls: 'calls',
  /** 我的贴纸 */
  stickers: 'stickers',
  drafts: 'drafts',
  /** 任一会话的消息 */
  messages: 'messages',
  chat: (chatId: string) => `chat:${chatId}`,
  /** 秘密聊天在本设备上的加密状态（加入、纪元变化） */
  secret: (chatId: string) => `secret:${chatId}`,
  members: (chatId: string) => `members:${chatId}`,
}
