// WebSocket 协议：帧格式、方法、持久更新。前后端共用，服务端对每个入站帧做校验。
// 见 docs/architecture/03-sync-protocol.md
import * as v from 'valibot'

export const MAX_TEXT_LENGTH = 4096
/** 入站帧的长度上限：秘密聊天的一条密文（最长的文本加密后约 22KB）要放得下 */
export const MAX_FRAME_BYTES = 32 * 1024
export const MAX_PAGE_LIMIT = 100
/** 服务端去重窗口：同一 (sender_id, random_id) 在此时间内重复提交返回第一次的结果；更早的重发由客户端先对账 */
export const DEDUP_WINDOW_MS = 10 * 60 * 1000
/** 群组人数上限（含群主），见 ADR-0002 */
export const MAX_GROUP_MEMBERS = 20
export const MAX_TITLE_LENGTH = 128
/** 备注名的长度上限 */
export const MAX_ALIAS_LENGTH = 64
/** 发送后多久内可以编辑 */
export const EDIT_WINDOW_MS = 60 * 60 * 1000
/** 发送后多久内可以撤回 */
export const RECALL_WINDOW_MS = 2 * 60 * 1000
/** 客户端心跳间隔；超过 2.5 倍没有心跳的连接视为已断开（例如设备休眠） */
export const HEARTBEAT_MS = 30_000
/** 查看者登记与在线状态观察的有效期；客户端在有效期内续订 */
export const PRESENCE_TTL_MS = 60_000
export const PRESENCE_RENEW_MS = 50_000
/** 输入中：客户端每个会话每种动作最多每 5 秒上报一次（录音期间每 5 秒上报一次），接收方 6 秒后自动消失 */
export const TYPING_THROTTLE_MS = 5_000
export const TYPING_TTL_MS = 6_000
/** 输入中的动作：打字或录语音消息 */
export const TYPING_ACTIONS = ['typing', 'recording'] as const
export type TypingAction = (typeof TYPING_ACTIONS)[number]
/** 一台设备同时查看的会话数上限（多个标签页） */
export const MAX_VIEWING = 10
/** 置顶对话的上限 */
export const MAX_PINNED_DIALOGS = 5
/** 每个会话置顶消息的上限 */
export const MAX_PINNED_MESSAGES = 10
/** 永久静音时 muted_until 的取值 */
export const MUTE_FOREVER = Number.MAX_SAFE_INTEGER
/** 一次转发最多发到几个会话 */
export const MAX_FORWARD_TARGETS = 10
/** 一条消息最多带多少个实体（提及） */
export const MAX_ENTITIES = 50
/** 可选的回应，按这个顺序显示 */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👎'] as const
export type ReactionEmoji = (typeof REACTIONS)[number]

// ---------- 媒体 ----------
// 见 docs/architecture/05-media.md

/** 单个媒体的大小上限：图片原图、压缩后的图片与视频、文件一律 20MB */
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024
/** 一个相册最多几项（图片与视频）；一次发送最多几项附件 */
export const MAX_ALBUM_SIZE = 10
export const MAX_FILE_NAME_LENGTH = 255
/** 客户端压缩图片的长边：大图用于全屏查看，预览图用于气泡与网格 */
export const PHOTO_SIZE = 2560
export const PREVIEW_SIZE = 800
/** 相册里的图片：客户端编码为 WebP，浏览器不支持时退回 JPEG；GIF 原样上传以保留动画 */
export const PHOTO_MIME_TYPES = ['image/webp', 'image/jpeg', 'image/gif'] as const
export const PREVIEW_MIME_TYPES = ['image/webp', 'image/jpeg'] as const
/**
 * 相册里的视频：客户端转码为 H.264/AAC 的 MP4（长边 VIDEO_SIZE），封面为长边 PREVIEW_SIZE 的图片。
 * 大小受 MAX_MEDIA_BYTES 约束，码率随时长降低，实际最长约 3 分钟；MAX_VIDEO_SECONDS 只是校验的上界
 * （本来就小的视频只重新封装，可以更长）。见 docs/architecture/05-media.md § 视频
 */
export const VIDEO_SIZE = 1280
export const MAX_VIDEO_SECONDS = 60 * 60
/** 语音消息：最长 5 分钟（到时自动发送），波形为 64 个 0–255 的采样（base64）。见 docs/architecture/05-media.md § 语音消息 */
export const MAX_VOICE_SECONDS = 300
export const WAVEFORM_LENGTH = 64
/** 录音码率约 32kbps，5 分钟约 1.3MB；Safari 录 AAC 时可能不理会码率，上限留足余量 */
export const MAX_VOICE_BYTES = 8 * 1024 * 1024
/** 录音格式（不带 codecs 参数）：优先 WebM/Opus，浏览器不支持时退回 MP4 */
export const VOICE_MIME_TYPES = ['audio/webm', 'audio/mp4'] as const
/** 链接预览卡片标题的长度上限 */
export const MAX_LINK_TITLE_LENGTH = 300
/**
 * 贴纸：静态图在客户端缩到长边 STICKER_SIZE，编码为 WebP（浏览器编不了时为 PNG，都保留透明）；
 * GIF 原样保留动画，尺寸可能更大。见 docs/architecture/05-media.md § 贴纸
 */
export const STICKER_SIZE = 512
export const MAX_STICKER_BYTES = 2 * 1024 * 1024
export const STICKER_MIME_TYPES = ['image/webp', 'image/png', 'image/gif'] as const
/** 我的贴纸的上限（不含已移除的） */
export const MAX_STICKERS = 200

// ---------- 通话 ----------
// 见 docs/architecture/04-realtime-and-fanout.md § 通话、docs/adr/0009-p2p-private-calls-sfu-group-calls.md

/** 来电响铃多久没人接就成为未接来电 */
export const RING_TIMEOUT_MS = 30_000
/** 通话中的设备断开连接后，等它重新连上的时间；超时即结束通话 */
export const CALL_GRACE_MS = 30_000
/** 一条信令（SDP，或 DataChannel 之前的其他消息）的长度上限 */
export const MAX_SIGNAL_LENGTH = 12 * 1024
/** 群组通话所在的标签页持有的 Web Lock：同步 Worker 排队等它，拿到即说明标签页没了，替它离开 */
export const GROUP_CALL_LOCK = 'web-chat-group-call'
/** 群组通话发给 SFU 的 SDP（压缩后 base64）的长度上限，留出帧里其余字段的余量 */
export const MAX_SFU_SDP_LENGTH = 15 * 1024

/** WebSocket 关闭码：同一设备的新连接顶替了旧连接，旧连接不能再重连，否则两边会互相踢下线 */
export const CLOSE_REPLACED = 4000
/** WebSocket 关闭码：设备已被移除，客户端应退出登录并清空本地数据 */
export const CLOSE_REVOKED = 4001
/** WebSocket 关闭码：客户端的协议版本与服务端不一致，客户端应重载页面换成新版本 */
export const CLOSE_OUTDATED = 4002

/**
 * 协议版本：帧、方法参数或结果、更新的格式有不兼容的变化时加一。服务端不兼容旧版本，
 * 版本不一致的连接以 CLOSE_OUTDATED 关闭（见 docs/adr/0013）
 */
export const PROTOCOL_VERSION = 1
/** 客户端连接 /ws 时带上协议版本的查询参数 */
export const PROTOCOL_PARAM = 'v'

// ---------- 秘密聊天 ----------
// 见 docs/adr/0010-secret-chats-multi-device-mls.md、docs/architecture/06-auth-and-security.md § 端到端加密

/** 一条密文（base64）的长度上限：文本最长 MAX_TEXT_LENGTH 个字符，加上回复、媒体描述、签名与 base64 的开销 */
export const MAX_CIPHER_LENGTH = 24 * 1024
/** 秘密聊天里加密上传的媒体对象比原文件多的字节数：12 字节 nonce 与 16 字节认证标签 */
export const SEALED_MEDIA_OVERHEAD = 28
/** 一个 MLS 提交或 Welcome（base64）的长度上限 */
export const MAX_MLS_LENGTH = 24 * 1024
/** 一个 KeyPackage（base64）的长度上限；套件 1 的约 430 个字符 */
export const MAX_KEY_PACKAGE_LENGTH = 2048
/** 每台设备在服务端放多少个一次性 KeyPackage，用到不足一半时补齐；另有一个可重复使用的最后备用 */
export const KEY_PACKAGES_PER_DEVICE = 4
/** 一次提交最多加入或移除多少台设备 */
export const MAX_SECRET_DEVICES = 40

// ---------- 推送 ----------
// 见 docs/architecture/04-realtime-and-fanout.md § Web Push

/** VAPID 公钥（base64url 编码的未压缩 P-256 点），浏览器订阅时使用；私钥是服务端的机密 VAPID_PRIVATE_KEY */
export const VAPID_PUBLIC_KEY = 'BKQwcINEBruDbVIkGrLbLhfvB50UJB5B4TIZAhYpirVUUOIhclD5KhcsXlXKIFchgn1wS1R5flE1k18t1lVxcJY'

/**
 * 推送载荷：文案由 UserDO 渲染好，Service Worker 只负责显示。
 * 每个会话一条通知（tag 为 chat_id）；silent 表示撤回或编辑后静默替换，不再提醒。badge 为角标的未读总数
 */
export type PushPayload = {
  chat_id: string
  seq: number
  title: string
  body: string
  badge: number
  silent: boolean
  /** 来电：通知一直显示到用户处理（不自动消失）；之后的通话记录用同一个 tag 替换它 */
  ring?: true
}

// ---------- 实体 ----------

/** 用户资料，以 IdP 为准；不含邮箱，防止被批量枚举 */
export type UserProfile = { id: string; name: string; image: string | null }

/**
 * 我与另一个用户的关系：是否联系人（及备注名）、是否被我拉黑，两者互相独立。
 * 两者都没有的行是墓碑，供其他设备同步删除
 */
export type Relation = { user_id: string; contact: boolean; alias: string | null; blocked: boolean }

export type ChatKind = 'private' | 'group' | 'secret'

/**
 * 媒体消息的摘要：相册给出总数与其中的视频数（没有视频时不出现），只有一个视频时再给出它的时长；
 * 文件消息只给出文件名，语音消息只给出时长
 */
export type MediaSummary =
  | { kind: 'album'; count: number; videos?: number; duration?: number }
  | { kind: 'file'; name: string }
  | { kind: 'voice'; duration: number }
  | { kind: 'sticker' }

/** 被置顶消息的摘要，记在置顶的服务消息里：文本截断，媒体消息见 MediaSummary */
export type PinExcerpt = { kind: 'text'; text: string } | MediaSummary

/** 服务消息的动作；动作者就是消息的 sender_id */
export type ServiceAction =
  /** user_ids：建群时拉进来的其他成员 */
  | { type: 'chat_create'; title: string; user_ids: string[] }
  | { type: 'members_add'; user_ids: string[] }
  /** 群主移除成员 */
  | { type: 'member_remove'; user_id: string }
  /** 主动退出；群主退出时 new_owner_id 为接任的群主 */
  | { type: 'member_leave'; new_owner_id: string | null }
  /** 凭邀请链接自己加入 */
  | { type: 'member_join' }
  | { type: 'title_edit'; title: string }
  /** 置顶了第 seq 条消息；取消置顶不产生服务消息 */
  | { type: 'message_pin'; seq: number; excerpt: PinExcerpt }
  /** 一对一通话的记录，动作者（sender_id）是主叫方；duration 为接通后的秒数，只在 ended 时出现 */
  | { type: 'call'; call_id: string; result: CallResult; duration?: number }
  /**
   * 群组通话的记录，动作者是发起者。发起时只有 call_id；结束时同一条改写，duration 为通话的秒数，
   * joined 为加入过的人（成员的 UserDO 据此记进各自的最近通话）
   */
  | { type: 'group_call'; call_id: string; duration?: number; joined?: string[] }
  /** 动作者开始了这个秘密聊天 */
  | { type: 'secret_create' }
  /** 秘密聊天里这些用户有新设备加入（包括丢了本地数据后重新加入），安全码随之变化；动作者是把它们拉进来的人 */
  | { type: 'secret_devices'; user_ids: string[] }

/**
 * 一对一通话的结果。ended：接通过；declined：被叫方拒绝；canceled：主叫方在接通前挂断；
 * missed：响铃超时；busy：被叫方忙线。对被叫方来说，canceled、missed、busy 都是未接来电
 */
export type CallResult = 'ended' | 'declined' | 'canceled' | 'missed' | 'busy'

/** 对被叫方来说是不是未接来电 */
export function isMissedCall(result: CallResult): boolean {
  return result === 'canceled' || result === 'missed' || result === 'busy'
}

/**
 * 一对一通话的状态。ringing：响铃中；active：已接听，device_id 为接听的那台设备；ended：已结束，result 为结果。
 * 只经瞬时事件与方法的返回值传递，不进本地库；结束后留下的是通话记录
 */
export type Call = {
  call_id: string
  chat_id: string
  caller_id: string
  callee_id: string
  state: 'ringing' | 'active' | 'ended'
  started_at: number
  device_id?: string
  result?: CallResult
}

/** 群组通话里一个人能发布的媒体：麦克风、摄像头、屏幕共享 */
export type CallSlot = 'mic' | 'camera' | 'screen'

/**
 * 群组通话的参与者。tracks 为已发布的媒体在 SFU 上的 track 名，没有的表示没在发；
 * muted 为麦克风静音（第一次开麦才发布麦克风，之后静音只是不出声，track 照旧）
 */
export type GroupCallMember = { user_id: string; joined_at: number; muted: boolean; tracks: Partial<Record<CallSlot, string>> }

/**
 * 群组通话的快照：seq 为会话里的通话记录。只经瞬时事件与方法的返回值传递，不进本地库
 */
export type GroupCall = {
  call_id: string
  chat_id: string
  started_by: string
  started_at: number
  seq: number
  participants: GroupCallMember[]
}

/** simulcast 的三层：f 原始分辨率，h 一半，q 四分之一；字母序靠前的优先 */
export type SimulcastRid = 'f' | 'h' | 'q'

/** 最近通话保留多少条，多设备同步；更早的服务端与客户端各自删掉，不留墓碑 */
export const MAX_RECENT_CALLS = 100

/**
 * 最近通话里的一条，来自会话里的通话记录（seq）。peer_id 为对方，caller_id 为主叫方；
 * date 为通话记录的时间（通话结束时），duration 为接通的秒数（没接通为 0）。
 * 群组通话（chat_id 为群组）的 peer_id 与 caller_id 都是发起者，result 总是 ended
 */
export type CallLog = {
  call_id: string
  chat_id: string
  seq: number
  peer_id: string
  caller_id: string
  result: CallResult
  duration: number
  date: number
}

/** ICE 服务器（RTCIceServer 的子集），由服务端签发短期的 TURN 凭据 */
export type IceServer = { urls: string | string[]; username?: string; credential?: string }

/**
 * 相册里的一张图片。key 为大图（GIF 为原图），preview_key 为长边 PREVIEW_SIZE 的预览图（GIF 取第一帧）；
 * w / h 为大图的尺寸；thumbhash 为 base64，用作加载前的占位
 */
export type Photo = { type: 'photo'; key: string; preview_key: string; w: number; h: number; size: number; thumbhash: string }
/**
 * 相册里的视频：key 为 MP4（H.264/AAC），preview_key 为封面（第一帧，长边 PREVIEW_SIZE）；
 * w / h 为显示尺寸（已按旋转换算），duration 为整秒（至少 1），thumbhash 取自封面
 */
export type Video = {
  type: 'video'
  key: string
  preview_key: string
  w: number
  h: number
  size: number
  duration: number
  thumbhash: string
}
/** 文件消息里的文件：原样上传，下载时使用原始文件名 */
export type MediaFile = { type: 'file'; key: string; name: string; mime: string; size: number }
/**
 * 语音消息里的录音：duration 为整秒（1–MAX_VOICE_SECONDS），录音文件本身可能不带时长（WebM），播放以它为准；
 * waveform 为 WAVEFORM_LENGTH 个 0–255 的音量采样，base64
 */
export type Voice = {
  type: 'voice'
  key: string
  mime: (typeof VOICE_MIME_TYPES)[number]
  size: number
  duration: number
  waveform: string
}
/**
 * 贴纸消息里的贴纸，或我的贴纸里的一张：只有一个对象（没有预览图），w / h 为它的尺寸，thumbhash 用作加载前的占位。
 * key 在 s/ 下：发送、转发、别人添加到自己的贴纸都引用同一个对象，撤回与移除都不删除它（见 ADR-0012）。
 * 秘密聊天里的贴纸是加密后另外上传的，key 在 m/ 下
 */
export type Sticker = {
  type: 'sticker'
  key: string
  mime: (typeof STICKER_MIME_TYPES)[number]
  w: number
  h: number
  size: number
  thumbhash: string
}
export type Media = Photo | Video | MediaFile | Voice | Sticker

/** 我的贴纸里的一张：added_at 为添加的时间，新加的排在前面 */
export type SavedSticker = Sticker & { added_at: number }
/** 我的贴纸的一次变化：sticker 为 null 表示被移除了 */
export type StickerChange = { key: string; sticker: SavedSticker | null }

/** 相册里的一项：图片或视频，都带预览图（视频的预览图即封面） */
export type AlbumItem = Photo | Video

/**
 * 待发键 → 发送后的键：{前缀}p/{user_id}/{随机}/{文件名} → {前缀}m/…，同一目录只换掉 p。
 * 上传先写到 p/（桶的生命周期规则会删掉没发出去的），发送时服务端复制到 m/，见 docs/adr/0008-pending-media-prefix.md
 */
export function sentKey(key: string): string {
  const parts = key.split('/')
  if (parts.at(-4) !== 'p') throw new Error(`not a pending key: ${key}`)
  parts[parts.length - 4] = 'm'
  return parts.join('/')
}

/** 待发键 → 贴纸的键：同一目录只换掉 p 为 s。添加贴纸时服务端复制过去，s/ 不受桶的生命周期规则管 */
export function savedKey(key: string): string {
  const parts = key.split('/')
  if (parts.at(-4) !== 'p') throw new Error(`not a pending key: ${key}`)
  parts[parts.length - 4] = 's'
  return parts.join('/')
}

/** 媒体消息发出后的样子：每个对象键换成发送后的键，其余字段（秘密聊天的密钥）照旧 */
export function sentMedia<T extends Media>(media: T[]): T[] {
  return media.map((m) =>
    m.type === 'photo' || m.type === 'video'
      ? { ...m, key: sentKey(m.key), preview_key: sentKey(m.preview_key) }
      : { ...m, key: sentKey(m.key) },
  )
}

/** 链接预览发出后的样子：卡片图片的键换成发送后的键 */
export function sentPreview(preview: LinkPreview): LinkPreview {
  return preview.type === 'web' && preview.photo ? { ...preview, photo: { ...preview.photo, key: sentKey(preview.photo.key) } } : preview
}

/** 媒体消息的摘要：一条媒体消息要么是相册，要么是恰好一个文件、一段录音或一张贴纸 */
export function summarizeMedia(media: Media[]): MediaSummary {
  const [first] = media
  switch (first?.type) {
    case 'file':
      return { kind: 'file', name: first.name }
    case 'voice':
      return { kind: 'voice', duration: first.duration }
    case 'sticker':
      return { kind: 'sticker' }
    default: {
      const videos = media.filter((m) => m.type === 'video')
      if (videos.length === 0) return { kind: 'album', count: media.length }
      const only = media.length === 1 ? videos[0]! : null
      return { kind: 'album', count: media.length, videos: videos.length, ...(only ? { duration: only.duration } : {}) }
    }
  }
}

/**
 * 文本消息里的实体；offset / length 以 UTF-16 码元计（JS 字符串下标）。目前只有提及：
 * 文本里是发送时对方自己的名字（@名字），user_id 指向被提及的人
 */
export type MessageEntity = { type: 'mention'; offset: number; length: number; user_id: string }

/** 链接预览卡片的图片：发送方取回网页的 og:image，压缩成长边 PREVIEW_SIZE 后上传，接收方不再访问那个网站 */
export type LinkPhoto = { key: string; w: number; h: number; thumbhash: string }

/**
 * 链接预览：只出现在纯链接消息上（见 shared/text 的 linkOnly），由发送方生成，只代表发送方的说法。
 * web：网页的标题与图片，都没有表示没抓到（显示链接图标与域名）；invite：本站邀请链接，记下发送时的群名与人数。
 * 卡片上的域名总是在显示时从正文里的链接算出，点击打开的也总是正文
 */
export type LinkPreview =
  | { type: 'web'; title: string | null; photo?: LinkPhoto }
  | { type: 'invite'; title: string; member_count: number }

/** 转发来源：最初的发送者与发送时间，多次转发也不变 */
export type ForwardFrom = { user_id: string; date: number }

/** 回应：emoji → 回应了它的用户，按 REACTIONS 的顺序；每人每条消息最多一个 */
export type Reactions = Partial<Record<ReactionEmoji, string[]>>

/**
 * reply_to：被回复消息的 seq，只在回复时出现；edit_date：最后一次编辑的时间；reactions：有回应时才出现；
 * pinned_at：置顶的时间，只在置顶着时出现；entities：有提及时才出现，按位置排序、互不重叠；
 * fwd_from：转发来的消息才有（转发来的不能编辑，其中的提及不算提及）；preview：链接预览，纯链接消息才可能有。
 * recalled：已撤回，内容已清空，客户端显示"X 撤回了一条消息"
 */
export type MessageBody =
  | {
      kind: 'text'
      text: string
      entities?: MessageEntity[]
      reply_to?: number
      edit_date?: number
      reactions?: Reactions
      pinned_at?: number
      fwd_from?: ForwardFrom
      preview?: LinkPreview
    }
  /** 媒体消息：相册（1–MAX_ALBUM_SIZE 项图片或视频）、文件消息（恰好一个文件）、语音消息（恰好一段录音）或贴纸消息（恰好一张贴纸），不带文字 */
  | { kind: 'media'; media: Media[]; reply_to?: number; reactions?: Reactions; pinned_at?: number; fwd_from?: ForwardFrom }
  | { kind: 'service'; action: ServiceAction }
  | { kind: 'recalled' }
  /**
   * 秘密聊天里的文本或媒体消息：cipher 为加密后的内容（客户端解开，服务端读不懂），edit_date 为最后一次编辑的时间；
   * reactions 为每个回应者加密后的回应（user_id → 密文）。见 docs/adr/0010-secret-chats-multi-device-mls.md
   */
  | { kind: 'cipher'; cipher: string; edit_date?: number; reactions?: Record<string, string> }

export type Message = {
  chat_id: string
  seq: number
  pts: number
  sender_id: string
  date: number
  /** 只在返回给发送者本人时出现，用于发件箱对账 */
  random_id?: number
} & MessageBody

/** 对话列表摘要：最后一条消息，正文截断；媒体消息见 MediaSummary */
export type DialogPreview = { sender_id: string; date: number } & (
  | { kind: 'text'; text: string }
  | MediaSummary
  | { kind: 'service'; action: ServiceAction }
  | { kind: 'recalled' }
  /** 秘密聊天的消息：摘要就是消息本身的密文，客户端解开后显示 */
  | { kind: 'cipher'; cipher: string }
)

/** 草稿：输入框里尚未发送的文字，连同正在回复的消息 */
export type Draft = { text: string; reply_to: number | null }

/** member：成员；left：只读对话（前成员）；deleted：已删除对话的墓碑，供其他设备同步删除 */
export type DialogStatus = 'member' | 'left' | 'deleted'

export type Dialog = {
  chat_id: string
  kind: ChatKind
  /** 群名；私聊与秘密聊天为 null */
  title: string | null
  status: DialogStatus
  pts: number
  top_seq: number
  top_preview: DialogPreview | null
  chat_pts: number
  /** 我读到哪 */
  last_read_seq: number
  /** 私聊中对方读到哪（已读回执）；群组暂不展示，恒为 0 */
  peer_read_seq: number
  /** 置顶对话的顺序，越大越靠前；没有置顶为 null */
  pinned_rank: number | null
  /** 静音到什么时候（毫秒时间戳）；0 或已过去表示没有静音，MUTE_FOREVER 为永久 */
  muted_until: number
  draft: Draft | null
  /** 未读提及：提及我（或回复我）的消息，seq 升序；读到之后移除 */
  unread_mentions: number[]
}

/**
 * 在线状态：在线，或最后上线时间。
 * 对方隐藏了最后上线时间（或自己隐藏了，对等）时只给出大致范围：
 * recently（3 天内，含在线）、week（一周内）、month（一月内）、long（更早）
 */
export type Presence =
  | { status: 'online' }
  | { status: 'offline'; last_seen: number }
  | { status: 'recently' | 'week' | 'month' | 'long' }

// ---------- 账号设置 ----------

/** 谁能看到我的最后上线时间与在线状态 */
export type LastSeenPrivacy = 'everyone' | 'nobody'
/**
 * 账号设置：存在 UserDO.settings，经 user_pts 多设备同步。
 * notification_preview：通知预览，关闭后通知只显示会话名与发送者
 */
export type Settings = { last_seen: LastSeenPrivacy; notification_preview: boolean }
export const DEFAULT_SETTINGS: Settings = { last_seen: 'everyone', notification_preview: true }

// ---------- 设备 ----------

/**
 * 设备列表中的一项。online：该设备当前在前台；last_active：最后一次处于前台的时间（0 表示从未在前台）。
 * 位置取最近一次连接，从没连接过的设备只有登录时的 IP
 */
export type DeviceInfo = {
  id: string
  current: boolean
  user_agent: string | null
  created_at: number
  online: boolean
  last_active: number
  ip: string | null
  country: string | null
  city: string | null
}

export type MemberRole = 'owner' | 'member'
export type ChatMember = { user_id: string; role: MemberRole; joined_at: number }
export type ChatInfo = { chat_id: string; kind: ChatKind; title: string | null; members: ChatMember[] }
/** 打开邀请链接时看到的群组：群名与当前人数；member 表示自己已经是成员 */
export type InvitePreview = { chat_id: string; title: string; member_count: number; member: boolean }

/** 消息涉及的用户：发送者、转发来源、回应者与服务消息里的对象，用于预取资料 */
export function messageUserIds(m: { sender_id: string } & MessageBody): string[] {
  if (m.kind === 'text' || m.kind === 'media') {
    return [m.sender_id, ...(m.fwd_from ? [m.fwd_from.user_id] : []), ...Object.values(m.reactions ?? {}).flat()]
  }
  if (m.kind === 'cipher') return [m.sender_id]
  if (m.kind !== 'service') return [m.sender_id]
  const a = m.action
  switch (a.type) {
    case 'chat_create':
    case 'members_add':
    case 'secret_devices':
      return [m.sender_id, ...a.user_ids]
    case 'member_remove':
      return [m.sender_id, a.user_id]
    case 'member_leave':
      return a.new_owner_id ? [m.sender_id, a.new_owner_id] : [m.sender_id]
    case 'member_join':
    case 'title_edit':
    case 'message_pin':
    case 'call':
    case 'group_call':
    case 'secret_create':
      return [m.sender_id]
  }
}

// ---------- 私聊 ID ----------

/** 私聊 ID：p:{小uid}:{大uid}，由两个用户 ID 确定性生成 */
export function privateChatId(a: string, b: string): string {
  return a < b ? `p:${a}:${b}` : `p:${b}:${a}`
}

/** 解析私聊 ID；格式不对、顺序不对或两端相同都返回 null */
export function parsePrivateChatId(chatId: string): [string, string] | null {
  const parts = chatId.split(':')
  if (parts.length !== 3 || parts[0] !== 'p') return null
  const [, a, b] = parts as [string, string, string]
  if (!a || !b || a >= b) return null
  return [a, b]
}

// ---------- 秘密聊天 ID ----------

const SECRET_CHAT_ID = /^s:([^:]+):([^:]+):([A-Za-z0-9_-]{22})$/

/** 秘密聊天 ID：s:{小uid}:{大uid}:{16 字节随机数的 base64url}。双方由 ID 得出；随机部分让删掉之后重开的是另一个会话 */
export function newSecretChatId(a: string, b: string): string {
  return `s:${a < b ? `${a}:${b}` : `${b}:${a}`}:${randomToken()}`
}

/** 解析秘密聊天 ID，返回双方；格式不对、顺序不对或两端相同都返回 null */
export function parseSecretChatId(chatId: string): [string, string] | null {
  const m = SECRET_CHAT_ID.exec(chatId)
  if (!m || m[1]! >= m[2]!) return null
  return [m[1]!, m[2]!]
}

/** 一对一的会话（私聊或秘密聊天）的双方；群组与格式不对的返回 null */
export function chatPair(chatId: string): [string, string] | null {
  return parsePrivateChatId(chatId) ?? parseSecretChatId(chatId)
}

// ---------- 群组 ID ----------

const GROUP_CHAT_ID = /^g:[A-Za-z0-9_-]{22}$/

/** 16 字节随机数的 base64url（22 个字符） */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 群组 ID：g:{16 字节随机数的 base64url}，由建群的客户端生成，重放建群请求不会建出第二个群 */
export function newGroupChatId(): string {
  return `g:${randomToken()}`
}

export function isGroupChatId(chatId: string): boolean {
  return GROUP_CHAT_ID.test(chatId)
}

// ---------- 邀请链接 ----------

const INVITE_CODE = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/

/** 邀请码：{群组 ID 去掉 g: 前缀}.{令牌}。令牌是 ChatDO 保存的随机数，重置即换一个，旧链接随之失效 */
export function inviteCode(chatId: string, token: string): string {
  return `${chatId.slice(2)}.${token}`
}

export function parseInviteCode(code: string): { chat_id: string; token: string } | null {
  const m = INVITE_CODE.exec(code)
  return m ? { chat_id: `g:${m[1]}`, token: m[2]! } : null
}

/** 邀请链接的路径，拼上应用的 Origin 即为完整链接 */
export function invitePath(code: string): string {
  return `/join/${code}`
}

// ---------- 方法 ----------

const ChatId = v.pipe(v.string(), v.minLength(1), v.maxLength(160))
const Pts = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const Seq = v.pipe(v.number(), v.safeInteger(), v.minValue(1))
const Limit = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_PAGE_LIMIT))
const UserId = v.pipe(v.string(), v.minLength(1), v.maxLength(64))
/** 客户端随机整数（JS 安全整数范围），用于写操作幂等 */
const RandomId = v.pipe(v.number(), v.safeInteger())
const Title = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_TITLE_LENGTH))
const InviteCode = v.pipe(v.string(), v.maxLength(64))
/** 通话 ID：主叫方生成的 randomToken，重放发起请求不会打出第二个通话 */
const CallId = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{22}$/))
const GroupChatId = v.pipe(v.string(), v.check(isGroupChatId))
const Slot = v.picklist(['mic', 'camera', 'screen'])
const Rid = v.picklist(['f', 'h', 'q'])
const Mid = v.pipe(v.string(), v.regex(/^[0-9]{1,4}$/))
const SfuSdp = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_SFU_SDP_LENGTH))
const UserIds = v.pipe(v.array(UserId), v.minLength(1), v.maxLength(MAX_GROUP_MEMBERS - 1))
/** 对象键的格式与归属由服务端另行校验 */
const MediaKey = v.pipe(v.string(), v.minLength(1), v.maxLength(512))
const MediaSize = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_MEDIA_BYTES))
const SealedSize = v.pipe(v.number(), v.safeInteger(), v.minValue(SEALED_MEDIA_OVERHEAD + 1), v.maxValue(MAX_MEDIA_BYTES + SEALED_MEDIA_OVERHEAD))
/** GIF 原样上传，尺寸可能超过 PHOTO_SIZE */
const Dimension = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(16384))
const FileName = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_FILE_NAME_LENGTH))
const Mime = v.pipe(v.string(), v.maxLength(127), v.regex(/^[\w.+-]+\/[\w.+-]+$/))

const SecretChatId = v.pipe(v.string(), v.check((id) => parseSecretChatId(id) !== null))
const Base64 = (max: number) => v.pipe(v.string(), v.minLength(1), v.maxLength(max), v.base64())
const Cipher = Base64(MAX_CIPHER_LENGTH)
const Epoch = v.pipe(v.number(), v.safeInteger(), v.minValue(1))
const DeviceId = v.pipe(v.string(), v.minLength(1), v.maxLength(128))
const SecretDevices = v.pipe(v.array(v.object({ user_id: UserId, device_id: DeviceId })), v.maxLength(MAX_SECRET_DEVICES))
const KeyPackageSchema = v.object({ ref: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{22}$/)), data: Base64(MAX_KEY_PACKAGE_LENGTH) })

/** 提及的位置与对象由服务端再校验：越界、重叠、对象不是当前成员的丢弃 */
const Entities = v.pipe(
  v.array(
    v.object({
      type: v.literal('mention'),
      offset: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
      length: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
      user_id: UserId,
    }),
  ),
  v.maxLength(MAX_ENTITIES),
)

const PhotoSchema = v.object({
  type: v.literal('photo'),
  key: MediaKey,
  preview_key: MediaKey,
  w: Dimension,
  h: Dimension,
  size: MediaSize,
  thumbhash: v.pipe(v.string(), v.maxLength(64), v.base64()),
})
const VideoSchema = v.object({
  type: v.literal('video'),
  key: MediaKey,
  preview_key: MediaKey,
  w: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(VIDEO_SIZE)),
  h: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(VIDEO_SIZE)),
  size: MediaSize,
  duration: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_VIDEO_SECONDS)),
  thumbhash: v.pipe(v.string(), v.maxLength(64), v.base64()),
})
const FileSchema = v.object({ type: v.literal('file'), key: MediaKey, name: FileName, mime: Mime, size: MediaSize })
const VoiceSize = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_VOICE_BYTES))
/** WAVEFORM_LENGTH 字节的 base64（带填充） */
const WAVEFORM_BASE64_LENGTH = Math.ceil(WAVEFORM_LENGTH / 3) * 4
const VoiceSchema = v.object({
  type: v.literal('voice'),
  key: MediaKey,
  mime: v.picklist(VOICE_MIME_TYPES),
  size: VoiceSize,
  duration: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_VOICE_SECONDS)),
  waveform: v.pipe(v.string(), v.length(WAVEFORM_BASE64_LENGTH), v.base64()),
})
const StickerSize = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_STICKER_BYTES))
const Thumbhash = v.pipe(v.string(), v.maxLength(64), v.base64())
const StickerSchema = v.object({
  type: v.literal('sticker'),
  key: MediaKey,
  mime: v.picklist(STICKER_MIME_TYPES),
  w: Dimension,
  h: Dimension,
  size: StickerSize,
  thumbhash: Thumbhash,
})

// 秘密聊天的加密内容：服务端看不到，客户端解开后按这里校验，不合格的当作验证失败。
// 见 docs/adr/0010-secret-chats-multi-device-mls.md

/** 加密媒体对象的密钥：AES-256-GCM，32 字节的 base64 */
const MediaSecret = v.pipe(v.string(), v.length(44), v.base64())
/** 消息里的对象键都是发送后的键 */
const SentMediaKey = v.pipe(MediaKey, v.check((key) => key.split('/').at(-4) === 'm'))
const sealed = { key: SentMediaKey, secret: MediaSecret }

/**
 * 加密的消息内容。媒体对象是用 secret 加密过的，键名不透露类型，所以图片另带 mime；
 * random_id 让客户端认出被服务端复制成两条的同一条密文
 */
export const SecretPayload = v.variant('t', [
  v.object({
    t: v.literal('text'),
    text: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TEXT_LENGTH)),
    reply_to: v.optional(Seq),
    random_id: RandomId,
  }),
  v.object({
    t: v.literal('media'),
    media: v.union([
      v.pipe(
        v.array(
          v.variant('type', [
            v.object({ ...PhotoSchema.entries, ...sealed, preview_key: SentMediaKey, mime: v.picklist(PHOTO_MIME_TYPES) }),
            v.object({ ...VideoSchema.entries, ...sealed, preview_key: SentMediaKey }),
          ]),
        ),
        v.minLength(1),
        v.maxLength(MAX_ALBUM_SIZE),
      ),
      v.strictTuple([v.object({ ...FileSchema.entries, ...sealed })]),
      v.strictTuple([v.object({ ...VoiceSchema.entries, ...sealed })]),
      v.strictTuple([v.object({ ...StickerSchema.entries, ...sealed })]),
    ]),
    reply_to: v.optional(Seq),
    random_id: RandomId,
  }),
])
export type SecretPayload = v.InferOutput<typeof SecretPayload>
/** 秘密聊天里加密上传的媒体 */
export type SealedMedia = Extract<SecretPayload, { t: 'media' }>['media'][number]

/** 是否纯链接、invite 是否指向本站、图片键的归属由服务端另行校验 */
const LinkPreviewSchema = v.variant('type', [
  v.object({
    type: v.literal('web'),
    title: v.nullable(v.pipe(v.string(), v.maxLength(MAX_LINK_TITLE_LENGTH))),
    photo: v.optional(
      v.object({
        key: MediaKey,
        w: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(PREVIEW_SIZE)),
        h: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(PREVIEW_SIZE)),
        thumbhash: v.pipe(v.string(), v.maxLength(64), v.base64()),
      }),
    ),
  }),
  v.object({
    type: v.literal('invite'),
    title: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TITLE_LENGTH)),
    member_count: v.pipe(v.number(), v.safeInteger(), v.minValue(0), v.maxValue(MAX_GROUP_MEMBERS)),
  }),
])

const Base64Url = (length: number) => v.pipe(v.string(), v.length(length), v.regex(/^[A-Za-z0-9_-]+$/))
/** 浏览器 PushSubscription 的 endpoint 与两把密钥（base64url）：p256dh 为 65 字节的公钥，auth 为 16 字节 */
export const PushSubscriptionSchema = v.object({
  endpoint: v.pipe(v.string(), v.maxLength(1024), v.url(), v.startsWith('https://')),
  p256dh: Base64Url(87),
  auth: Base64Url(22),
})
export type PushSubscriptionKeys = v.InferOutput<typeof PushSubscriptionSchema>

export const methodParams = {
  'users.resolve': v.object({ email: v.pipe(v.string(), v.trim(), v.email(), v.maxLength(320)) }),
  'users.get': v.object({
    ids: v.pipe(v.array(UserId), v.minLength(1), v.maxLength(MAX_PAGE_LIMIT)),
  }),
  /** entities：提及，只在群组里有效；preview：链接预览，只有纯链接消息才能带 */
  'messages.send': v.object({
    chat_id: ChatId,
    random_id: RandomId,
    text: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TEXT_LENGTH)),
    entities: v.optional(Entities),
    reply_to: v.optional(Seq),
    preview: v.optional(LinkPreviewSchema),
  }),
  /** 发送媒体消息：相册（1–MAX_ALBUM_SIZE 项图片或视频，可以混排）、恰好一个文件或恰好一段录音，媒体须已上传 */
  'messages.sendMedia': v.object({
    chat_id: ChatId,
    random_id: RandomId,
    media: v.union([
      v.pipe(v.array(v.variant('type', [PhotoSchema, VideoSchema])), v.minLength(1), v.maxLength(MAX_ALBUM_SIZE)),
      v.strictTuple([FileSchema]),
      v.strictTuple([VoiceSchema]),
    ]),
    reply_to: v.optional(Seq),
  }),
  /** 发送我的贴纸里的一张（key 为它在 s/ 下的键），消息引用同一个对象 */
  'messages.sendSticker': v.object({ chat_id: ChatId, random_id: RandomId, key: MediaKey, reply_to: v.optional(Seq) }),
  'messages.history': v.object({
    chat_id: ChatId,
    /** 不传表示从最新一条往回取 */
    before_seq: v.optional(Seq),
    limit: Limit,
  }),
  /**
   * 编辑自己的文本消息（EDIT_WINDOW_MS 内）；提及随之替换，但不产生新的未读提及。
   * 链接预览在链接没变时保留，否则去掉，不重新生成
   */
  'messages.edit': v.object({
    chat_id: ChatId,
    seq: Seq,
    text: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_TEXT_LENGTH)),
    entities: v.optional(Entities),
  }),
  /** 撤回自己的文本消息（RECALL_WINDOW_MS 内），对所有成员生效 */
  'messages.recall': v.object({ chat_id: ChatId, seq: Seq }),
  /**
   * 把一条自己读得到的文本或媒体消息转发到 to_chat_id，成为自己的一条新消息；媒体在服务端复制一份。
   * 一次转发到多个会话时每个会话各调用一次，各用各的 random_id
   */
  'messages.forward': v.object({ from_chat_id: ChatId, seq: Seq, to_chat_id: ChatId, random_id: RandomId }),
  /** 回应一条文本或媒体消息；emoji 为 null 表示取消自己的回应 */
  'messages.react': v.object({ chat_id: ChatId, seq: Seq, emoji: v.nullable(v.picklist(REACTIONS)) }),
  /**
   * 置顶一条文本或媒体消息（MAX_PINNED_MESSAGES 条以内），产生一条服务消息；已经置顶着时什么都不做。
   * 群组只有群主可以，私聊双方都可以
   */
  'messages.pin': v.object({ chat_id: ChatId, random_id: RandomId, seq: Seq }),
  /** 取消置顶，不产生服务消息；权限同置顶 */
  'messages.unpin': v.object({ chat_id: ChatId, seq: Seq }),
  /** 按 seq 取消息，用于渲染本地没有的回复引用与置顶消息；读不到的 seq 不返回 */
  'messages.get': v.object({ chat_id: ChatId, seqs: v.pipe(v.array(Seq), v.minLength(1), v.maxLength(MAX_PAGE_LIMIT)) }),
  /** 已读位置前移到 max_seq；客户端按会话节流 */
  'messages.read': v.object({ chat_id: ChatId, max_seq: Seq }),
  'sync.user': v.object({ pts: Pts }),
  /**
   * 设备状态：页面是否可见、正在查看哪些会话（多个标签页汇总）。连接建立后先发一次，变化时再发，
   * 查看期间每 PRESENCE_RENEW_MS 续订；返回正在查看的私聊对象的在线状态
   */
  'presence.update': v.object({
    visible: v.boolean(),
    viewing: v.pipe(v.array(ChatId), v.maxLength(MAX_VIEWING)),
  }),
  /** 正在输入（打字或录音），只转发给正在查看该会话的其他成员 */
  'presence.typing': v.object({ chat_id: ChatId, action: v.picklist(TYPING_ACTIONS) }),
  'sync.chat': v.object({ chat_id: ChatId, pts: Pts, limit: Limit }),
  /** 建群：user_ids 为除自己以外的初始成员 */
  'chats.create': v.object({
    chat_id: v.pipe(v.string(), v.check(isGroupChatId)),
    random_id: RandomId,
    title: Title,
    user_ids: UserIds,
  }),
  'chats.get': v.object({ chat_id: ChatId }),
  'chats.addMembers': v.object({ chat_id: ChatId, random_id: RandomId, user_ids: UserIds }),
  'chats.removeMember': v.object({ chat_id: ChatId, random_id: RandomId, user_id: UserId }),
  'chats.leave': v.object({ chat_id: ChatId, random_id: RandomId }),
  'chats.editTitle': v.object({ chat_id: ChatId, random_id: RandomId, title: Title }),
  /** 群组的邀请链接：只有当前成员能拿到，第一次有人要时生成 */
  'chats.getInvite': v.object({ chat_id: ChatId }),
  /** 群主重置邀请链接，旧链接随之失效 */
  'chats.resetInvite': v.object({ chat_id: ChatId }),
  /** 打开邀请链接：链接失效返回 not_found，被群主移除过返回 forbidden */
  'chats.checkInvite': v.object({ code: InviteCode }),
  /** 凭邀请链接加入；群已满返回 chat_full，其余同 checkInvite */
  'chats.join': v.object({ code: InviteCode, random_id: RandomId }),
  /** 修改账号设置；只传要改的项 */
  'settings.set': v.object({
    last_seen: v.optional(v.picklist(['everyone', 'nobody'])),
    notification_preview: v.optional(v.boolean()),
  }),
  /** 加为联系人，或修改联系人的备注名；alias 为 null 表示不设备注名 */
  'contacts.set': v.object({
    user_id: UserId,
    alias: v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(MAX_ALIAS_LENGTH))),
  }),
  'contacts.remove': v.object({ user_id: UserId }),
  /**
   * 添加到我的贴纸。upload：key 为已上传的待发键（格式由键的扩展名决定），服务端复制到 s/；
   * message：一条读得到的贴纸消息里的贴纸，引用同一个对象（已经在我的贴纸里的不重复添加）。
   * 已有 MAX_STICKERS 张时返回 sticker_limit；重放不会添加第二张
   */
  'stickers.add': v.variant('from', [
    v.object({ from: v.literal('upload'), key: MediaKey, w: Dimension, h: Dimension, size: StickerSize, thumbhash: Thumbhash }),
    v.object({ from: v.literal('message'), chat_id: ChatId, seq: Seq }),
  ]),
  /** 从我的贴纸里移除；对象不删除，已经发出的贴纸消息照常显示 */
  'stickers.remove': v.object({ key: MediaKey }),
  /** 拉黑与解除拉黑，见 ADR-0007 */
  'users.block': v.object({ user_id: UserId }),
  'users.unblock': v.object({ user_id: UserId }),
  /** 删除对话：只适用于只读对话 */
  'dialogs.delete': v.object({ chat_id: ChatId }),
  /** 置顶、静音与草稿：只传要改的项。草稿只有成员能写，null 或空草稿表示清除 */
  'dialogs.update': v.object({
    chat_id: ChatId,
    pinned: v.optional(v.boolean()),
    muted_until: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
    draft: v.optional(
      v.nullable(v.object({ text: v.pipe(v.string(), v.maxLength(MAX_TEXT_LENGTH)), reply_to: v.nullable(Seq) })),
    ),
  }),
  'devices.list': v.object({}),
  /** 移除一台其他设备；本机用退出登录 */
  'devices.revoke': v.object({ device_id: v.pipe(v.string(), v.minLength(1), v.maxLength(128)) }),
  /** 移除除本机以外的所有设备 */
  'devices.revokeOthers': v.object({}),
  /** 本机的推送订阅，每次连接都上报；null 表示本机不接收推送 */
  'push.set': v.object({ subscription: v.nullable(PushSubscriptionSchema) }),
  /**
   * 在私聊里发起一对一通话：对方忙线时返回已结束（busy）的通话；对方正好在呼叫我时返回对方的来电。
   * 发起的设备就是通话所在的设备
   */
  'calls.start': v.object({ chat_id: ChatId, call_id: CallId }),
  /** 在本设备接听来电 */
  'calls.accept': v.object({ chat_id: ChatId, call_id: CallId }),
  /** 挂断：响铃中主叫方挂断是取消、被叫方挂断是拒绝，接通后任一方挂断是结束。已经结束的不报错 */
  'calls.end': v.object({ chat_id: ChatId, call_id: CallId }),
  /** 发给通话另一端设备的信令（SDP）；delivered 表示对方的设备收到了 */
  'calls.signal': v.object({ chat_id: ChatId, call_id: CallId, data: v.pipe(v.string(), v.maxLength(MAX_SIGNAL_LENGTH)) }),
  /**
   * 连上后询问自己当前的通话：正在响铃的来电，或本设备上进行中的通话（断线重连后据此认领回来）。
   * 连接断开期间，本设备的通话在 CALL_GRACE_MS 内认领回来就不会结束
   */
  'calls.current': v.object({}),
  /**
   * 在本设备加入群组里进行中的通话；没有时以 call_id 发起（发起者开着麦克风，其余人加入时静音）。
   * 已经在别的设备上参加的，转到本设备
   */
  'group_calls.join': v.object({ chat_id: GroupChatId, call_id: CallId }),
  /** 离开；最后一人离开时通话结束 */
  'group_calls.leave': v.object({ chat_id: GroupChatId, call_id: CallId }),
  /** 发布媒体：sdp 为本端的 offer（压缩），tracks 为新加的收发器；返回 SFU 的 answer */
  'group_calls.publish': v.object({
    chat_id: GroupChatId,
    call_id: CallId,
    sdp: SfuSdp,
    tracks: v.pipe(v.array(v.object({ mid: Mid, slot: Slot })), v.minLength(1), v.maxLength(3)),
  }),
  /** 停止发布：sdp 为停掉收发器之后的 offer（压缩）；返回 SFU 的 answer */
  'group_calls.unpublish': v.object({
    chat_id: GroupChatId,
    call_id: CallId,
    sdp: SfuSdp,
    slots: v.pipe(v.array(Slot), v.minLength(1), v.maxLength(3)),
  }),
  /**
   * 拉取别人发布的媒体，按人与媒体指定（服务端换成 SFU 上的 session 与 track）；rid 只对摄像头有效。
   * 返回 SFU 的 offer，本端回 group_calls.answer
   */
  'group_calls.pull': v.object({
    chat_id: GroupChatId,
    call_id: CallId,
    tracks: v.pipe(v.array(v.object({ user_id: UserId, slot: Slot, rid: v.optional(Rid) })), v.minLength(1), v.maxLength(60)),
  }),
  /** 回给 SFU 的 answer（压缩） */
  'group_calls.answer': v.object({ chat_id: GroupChatId, call_id: CallId, sdp: SfuSdp }),
  /** 换一路已经拉取的摄像头的 simulcast 层 */
  'group_calls.layer': v.object({ chat_id: GroupChatId, call_id: CallId, mid: Mid, user_id: UserId, rid: Rid }),
  /** 麦克风静音与否，只是告诉其他参与者 */
  'group_calls.mute': v.object({ chat_id: GroupChatId, call_id: CallId, muted: v.boolean() }),
  /** 本设备在服务端还有几个一次性 KeyPackage、有没有最后备用的 */
  'secrets.keys': v.object({}),
  /**
   * 上传本设备的 KeyPackage（ref 为客户端生成的随机 ID，私钥按它存在本地）；replace 时先删掉本设备原有的
   * （本地数据丢了，私钥对不上了）
   */
  'secrets.publish': v.object({
    replace: v.boolean(),
    key_packages: v.pipe(v.array(KeyPackageSchema), v.maxLength(KEY_PACKAGES_PER_DEVICE)),
    last_resort: v.optional(KeyPackageSchema),
  }),
  /** 开始秘密聊天之前：领取对方每台设备与自己其他设备的 KeyPackage（一次性的用掉即删） */
  'secrets.prepare': v.object({ user_id: UserId }),
  /** 开始秘密聊天：adds 为 Welcome 里加入的设备（除本设备以外的双方所有设备），纪元为 1 */
  'secrets.create': v.object({ chat_id: SecretChatId, random_id: RandomId, welcome: Base64(MAX_MLS_LENGTH), adds: SecretDevices }),
  /** 秘密聊天的当前纪元、在组里的设备、双方现有的设备与要重新加入的设备；成员设备据此提交加入或移除 */
  'secrets.state': v.object({ chat_id: SecretChatId }),
  /** 领取要加入的设备的 KeyPackage */
  'secrets.claim': v.object({ chat_id: SecretChatId, devices: v.pipe(SecretDevices, v.minLength(1)) }),
  /** 提交：从当前纪元前进到 epoch，加入 adds（带 Welcome）、移除 removes */
  'secrets.commit': v.object({
    chat_id: SecretChatId,
    epoch: v.pipe(Epoch, v.minValue(2)),
    commit: Base64(MAX_MLS_LENGTH),
    welcome: v.optional(Base64(MAX_MLS_LENGTH)),
    adds: SecretDevices,
    removes: v.pipe(v.array(DeviceId), v.maxLength(MAX_SECRET_DEVICES)),
  }),
  /** 纪元 after 之后的提交，按纪元排序；加入本设备的提交带 Welcome */
  'secrets.commits': v.object({ chat_id: SecretChatId, after: v.pipe(v.number(), v.safeInteger(), v.minValue(0)) }),
  /** 本设备丢了这个秘密聊天的本地状态：请成员设备把它移除后重新加入 */
  'secrets.reset': v.object({ chat_id: SecretChatId }),
  /** 发送加密的消息：epoch 必须是当前纪元；keys 为加密后上传的媒体对象（待发键） */
  'secrets.send': v.object({
    chat_id: SecretChatId,
    random_id: RandomId,
    epoch: Epoch,
    cipher: Cipher,
    keys: v.optional(v.pipe(v.array(MediaKey), v.minLength(1), v.maxLength(MAX_ALBUM_SIZE * 2))),
  }),
  /** 编辑自己的消息（EDIT_WINDOW_MS 内）：整条换成新的密文 */
  'secrets.edit': v.object({ chat_id: SecretChatId, seq: Seq, epoch: Epoch, cipher: Cipher }),
  /** 回应：cipher 为加密后的 emoji，null 表示取消 */
  'secrets.react': v.object({ chat_id: SecretChatId, seq: Seq, epoch: Epoch, cipher: v.nullable(Cipher) }),
} as const

export type Method = keyof typeof methodParams
export type MethodParams<M extends Method> = v.InferOutput<(typeof methodParams)[M]>

/** pinned：当前置顶的消息（能读到的），后置顶的在前；客户端据此拉取本地没有的 */
export type ChatDiff =
  | { too_long: false; messages: Message[]; pts: number; pinned: number[] }
  | { too_long: true; top_seq: number; pts: number; pinned: number[] }

/** 秘密聊天里的一台设备 */
export type SecretDevice = { user_id: string; device_id: string }
/** 领到的 KeyPackage（base64 的 MLSMessage） */
export type ClaimedKeyPackage = SecretDevice & { key_package: string }

/**
 * 秘密聊天的成员状态：epoch 为当前纪元，leaves 为组里的设备，devices 为双方现有（能加入）的设备，
 * resets 为丢了本地状态、要先移除再重新加入的设备
 */
export type SecretState = { epoch: number; leaves: SecretDevice[]; devices: Record<string, string[]>; resets: string[] }

/**
 * 一次提交：从 epoch − 1 前进到 epoch。commit 为 MLS 提交（创建时为 null，那时只有 Welcome）；
 * welcome 只在它加入了请求的设备时出现
 */
export type SecretCommit = {
  epoch: number
  sender_id: string
  device_id: string
  date: number
  commit: string | null
  welcome?: string
  adds: SecretDevice[]
  removes: string[]
}

/** 产生一条消息的写操作的结果 */
export type Written = { seq: number; pts: number; date: number }

export type MethodResults = {
  'users.resolve': { user: UserProfile }
  'users.get': { users: UserProfile[] }
  'messages.send': Written
  'messages.sendMedia': Written
  'messages.sendSticker': Written
  'messages.history': { messages: Message[] }
  'messages.get': { messages: Message[] }
  'messages.edit': null
  'messages.recall': null
  'messages.react': null
  'messages.forward': Written
  /** 已经置顶着时为 null */
  'messages.pin': Written | null
  'messages.unpin': null
  'messages.read': null
  /** settings：自 pts 之后有变化时返回完整设置，否则为 null */
  /** calls：最近通话里新增的（只增不改，超出 MAX_RECENT_CALLS 的由客户端自己删） */
  /** stickers：我的贴纸自 pts 之后的变化 */
  'sync.user': {
    dialogs: Dialog[]
    relations: Relation[]
    settings: Settings | null
    calls: CallLog[]
    stickers: StickerChange[]
    pts: number
  }
  'sync.chat': ChatDiff
  /** group_calls：正在查看的群组里进行中的通话（没列出的就是没有） */
  'presence.update': { peers: { user_id: string; presence: Presence }[]; group_calls: GroupCall[] }
  'presence.typing': null
  'chats.create': Written
  'chats.get': { chat: ChatInfo }
  'chats.addMembers': Written
  'chats.removeMember': Written
  'chats.leave': Written
  'chats.editTitle': Written
  'chats.getInvite': { code: string }
  'chats.resetInvite': { code: string }
  'chats.checkInvite': InvitePreview
  'chats.join': Written
  'dialogs.delete': null
  'dialogs.update': null
  'contacts.set': null
  'contacts.remove': null
  'stickers.add': null
  'stickers.remove': null
  'users.block': null
  'users.unblock': null
  'settings.set': null
  'devices.list': { devices: DeviceInfo[] }
  'devices.revoke': null
  'devices.revokeOthers': null
  'push.set': null
  'calls.start': { call: Call; ice_servers: IceServer[] }
  'calls.accept': { call: Call; ice_servers: IceServer[] }
  'calls.end': null
  'calls.signal': { delivered: boolean }
  /** ice_servers 只在通话属于本设备时出现 */
  'calls.current': { call: Call | null; ice_servers?: IceServer[]; group_call?: GroupCall }
  'group_calls.join': { call: GroupCall; ice_servers: IceServer[] }
  'group_calls.leave': null
  'group_calls.publish': { sdp: string }
  'group_calls.unpublish': { sdp: string }
  /** sdp 为 null 表示一路都没拉到；拉不到的（已经不在发了）带 error */
  'group_calls.pull': { sdp: string | null; tracks: PulledTrack[] }
  'group_calls.answer': null
  'group_calls.layer': null
  'group_calls.mute': null
  /** device_id：本设备的 ID（客户端据此生成凭证、认出自己的叶子） */
  'secrets.keys': { count: number; last_resort: boolean; device_id: string }
  'secrets.publish': null
  'secrets.prepare': { key_packages: ClaimedKeyPackage[] }
  'secrets.create': Written
  'secrets.state': SecretState
  'secrets.claim': { key_packages: ClaimedKeyPackage[] }
  'secrets.commit': null
  'secrets.commits': { commits: SecretCommit[] }
  'secrets.reset': null
  'secrets.send': Written
  'secrets.edit': null
  'secrets.react': null
}

/** 拉取的一路媒体：track 为它在 SFU 上的名字，mid 为本端接收它的收发器 */
export type PulledTrack = { user_id: string; slot: CallSlot; track: string; mid: string } | { user_id: string; slot: CallSlot; error: 'gone' }

export type ErrorCode =
  | 'bad_request'
  | 'unknown_method'
  | 'not_found'
  | 'forbidden'
  | 'self_chat'
  /** 群组已满（MAX_GROUP_MEMBERS） */
  | 'chat_full'
  /** 超过编辑或撤回的时限 */
  | 'expired'
  /** 私聊一方拉黑了另一方；拉人进群时为对象拉黑了发起者，错误里带上这些对象的 user_ids */
  | 'blocked'
  /** 置顶对话（MAX_PINNED_DIALOGS）或置顶消息（MAX_PINNED_MESSAGES）已达上限 */
  | 'pin_limit'
  /** 我的贴纸已有 MAX_STICKERS 张 */
  | 'sticker_limit'
  /** 发送时待发的媒体已经过期被删（发件箱放了太久），重新上传后再发 */
  | 'media_expired'
  /** 自己已经在另一个通话里（或有来电在响） */
  | 'busy'
  /** 通话已经结束，或已经在另一台设备上接听 */
  | 'call_ended'
  /** 秘密聊天：提交或消息不是基于当前纪元的，先追上提交再重试 */
  | 'stale_epoch'
  /** 秘密聊天：对方没有能加入的设备（还没有设备打开过应用） */
  | 'no_keys'
  | 'internal'

// ---------- 媒体上传（HTTP） ----------

/**
 * POST /api/media/upload：为一次发送的媒体批量签发预签名 PUT。
 * 相册里每张图片需要大图与预览图两个对象，视频需要视频与封面两个对象，文件只需要一个
 */
export const UploadRequest = v.object({
  media: v.pipe(
    v.array(
      v.variant('type', [
        v.object({
          type: v.literal('photo'),
          mime: v.picklist(PHOTO_MIME_TYPES),
          size: MediaSize,
          preview_mime: v.picklist(PREVIEW_MIME_TYPES),
          preview_size: MediaSize,
        }),
        /** 视频：MP4 与封面 */
        v.object({
          type: v.literal('video'),
          size: MediaSize,
          preview_mime: v.picklist(PREVIEW_MIME_TYPES),
          preview_size: MediaSize,
        }),
        v.object({ type: v.literal('file'), name: FileName, mime: Mime, size: MediaSize }),
        /** 链接预览卡片的图片：只有一个对象，已压缩成预览图的大小 */
        v.object({ type: v.literal('link'), mime: v.picklist(PREVIEW_MIME_TYPES), size: MediaSize }),
        /** 语音消息的录音：一个对象 */
        v.object({ type: v.literal('voice'), mime: v.picklist(VOICE_MIME_TYPES), size: VoiceSize }),
        /** 要添加到我的贴纸的图片：一个对象 */
        v.object({ type: v.literal('sticker'), mime: v.picklist(STICKER_MIME_TYPES), size: StickerSize }),
        /** 秘密聊天里加密过的媒体：服务端只知道大小；相册的图片与视频还有加密过的预览图（封面） */
        v.object({ type: v.literal('sealed'), size: SealedSize, preview_size: v.optional(SealedSize) }),
      ]),
    ),
    v.minLength(1),
    v.maxLength(MAX_ALBUM_SIZE),
  ),
})
export type UploadRequest = v.InferOutput<typeof UploadRequest>

/** 一个预签名 PUT：请求必须原样带上 headers，请求体的字节数必须与申请时一致 */
export type UploadTarget = { key: string; url: string; headers: Record<string, string> }
/** 与请求一一对应；相册的图片与视频带 preview */
export type UploadResponse = { media: { main: UploadTarget; preview?: UploadTarget }[] }

/** DELETE /api/media：删除自己上传、但没有发送出去的对象（只接受待发键） */
export const DeleteMediaRequest = v.object({
  keys: v.pipe(v.array(MediaKey), v.minLength(1), v.maxLength(MAX_ALBUM_SIZE * 2)),
})

// ---------- 链接预览（HTTP） ----------
// 见 docs/architecture/05-media.md § 链接预览

/**
 * POST /api/link-preview：Worker 抓取网页，返回标题与 og:image 的地址（都可能为 null）；
 * POST /api/link-preview/image：Worker 取回这张图交给发送方压缩上传
 */
export const LinkPreviewRequest = v.object({ url: v.pipe(v.string(), v.maxLength(2048)) })
export type LinkMeta = { title: string | null; image: string | null }

// ---------- 持久更新 ----------

/**
 * update_message：消息被编辑、撤回、回应、置顶或取消置顶，message 为变更后的完整消息。
 * mentioned：群组新消息提及的人（含被回复的人，不含发送者），成员的 UserDO 据此记未读提及
 */
export type ChatEvent =
  | { type: 'new_message'; message: Message; mentioned?: string[] }
  | { type: 'update_message'; message: Message }
export type UserEvent =
  | { type: 'dialog'; dialog: Dialog }
  | { type: 'settings'; settings: Settings }
  | { type: 'relation'; relation: Relation }
  | { type: 'call'; call: CallLog }
  | ({ type: 'sticker' } & StickerChange)

export type Update =
  | { k: 'chat'; chat_id: string; pts: number; pts_count: number; ev: ChatEvent }
  | { k: 'user'; pts: number; ev: UserEvent }

// ---------- 瞬时事件 ----------

/** 不落库、不占序号的事件：丢了无害，也不补 */
export type Transient =
  | { type: 'typing'; chat_id: string; user_id: string; action: TypingAction }
  | { type: 'presence'; user_id: string; presence: Presence }
  /** 通话状态变化：来电、接听（device_id 为接听的设备）、结束；推给双方的所有设备 */
  | { type: 'call'; call: Call }
  /** 通话另一端发来的信令，只推给本端通话所在的设备 */
  | { type: 'call_signal'; call_id: string; data: string }
  /** 群组通话的变化（null 为已结束）：推给参与者与正在查看这个群组的成员。mine：自己参加着，并且就在这台设备上 */
  | { type: 'group_call'; chat_id: string; call: GroupCall | null; mine: boolean }
  /** 秘密聊天有了新的提交，或有设备等着加入、移除：成员设备拉取状态与提交 */
  | { type: 'secret'; chat_id: string }

// ---------- 帧 ----------

export const ReqFrame = v.object({
  t: v.literal('req'),
  id: v.pipe(v.number(), v.safeInteger()),
  m: v.string(),
  p: v.unknown(),
})

export type Res =
  | { t: 'res'; id: number; ok: true; r: unknown }
  /** user_ids：与错误有关的用户（目前只有 blocked） */
  | { t: 'res'; id: number; ok: false; e: ErrorCode; user_ids?: string[] }
export type Upd = { t: 'upd'; u: Update[] }
export type Evt = { t: 'evt'; e: Transient[] }
export type ServerFrame = Res | Upd | Evt

/** 心跳：由 setWebSocketAutoResponse 直接回复，不唤醒 DO */
export const PING = 'ping'
export const PONG = 'pong'

export function isMethod(m: string): m is Method {
  return Object.hasOwn(methodParams, m)
}
