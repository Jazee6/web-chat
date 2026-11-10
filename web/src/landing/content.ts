// 介绍页的中英文文案。事实以 README、CONTEXT.md 与 docs/architecture 为准，改功能时一起改这里

export type Lang = 'en' | 'zh'

/** 介绍页总是指向官网：所有部署共用同一份内容，canonical、hreflang 与 sitemap 都写死这个地址（ADR-0015） */
export const SITE = 'https://chat.jaze.top'
export const REPO = 'https://github.com/Jazee6/web-chat'
export const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/Jazee6/web-chat'

export const PATHS: Record<Lang, string> = { en: '/', zh: '/zh' }
export const HTML_LANG: Record<Lang, string> = { en: 'en', zh: 'zh-Hans' }
export const OG_LOCALE: Record<Lang, string> = { en: 'en_US', zh: 'zh_CN' }

type Feature = { title: string; body: string }
type Faq = { q: string; a: string }
type Step = { title: string; body: string }

export type Copy = {
  title: string
  description: string
  ogTitle: string
  ogImageAlt: string
  nav: { skip: string; features: string; architecture: string; deploy: string; faq: string; signIn: string; switchLang: string }
  hero: { eyebrow: string; title: string; lead: string; open: string; deploy: string; source: string; facts: string[] }
  demo: {
    label: string
    search: string
    group: string
    members: string
    people: { carol: string; bob: string; dan: string }
    dialogs: { name: string; preview: string; time: string }[]
    carol: string
    me: string
    meReplyTo: string
    linkTitle: string
    linkDomain: string
    typing: string
    composer: string
  }
  features: { title: string; lead: string; items: Feature[] }
  architecture: {
    title: string
    lead: string
    browser: string
    browserItems: string[]
    worker: string
    workerItems: string[]
    userDo: string
    chatDo: string
    d1: string
    r2: string
    r2Items: string[]
    notes: Feature[]
  }
  budget: { title: string; lead: string; items: { value: string; label: string }[] }
  deploy: { title: string; lead: string; steps: Step[]; button: string; manual: string }
  faq: { title: string; items: Faq[] }
  footer: { tagline: string; license: string; source: string; docs: string }
}

const en: Copy = {
  title: 'Web Chat · Open-source Telegram-style chat on Cloudflare Workers',
  description:
    'Web Chat is an open-source, Telegram-style chat app that runs entirely on Cloudflare Workers, Durable Objects, D1 and R2: groups, end-to-end encrypted secret chats, voice and video calls, media and offline-first sync. Deploy your own on the free plan.',
  ogTitle: 'Web Chat · Your own chat app on the Cloudflare free plan',
  ogImageAlt: 'Web Chat: a group conversation with replies, reactions, a voice message and a link preview',
  nav: { skip: 'Skip to content', features: 'Features', architecture: 'Architecture', deploy: 'Deploy', faq: 'FAQ', signIn: 'Open Web Chat', switchLang: '中文' },
  hero: {
    eyebrow: 'Open source · Apache-2.0',
    title: 'Your own Telegram-style chat, on the Cloudflare free plan',
    lead: 'Groups, end-to-end encrypted secret chats, calls, voice messages and stickers. Messages live in your browser and sync across devices, and the whole server is one Worker you deploy with a single click.',
    open: 'Open Web Chat',
    deploy: 'Deploy your own',
    source: 'View source',
    facts: ['Workers Free plan', 'Works offline', 'Sign in with any OpenID Connect provider'],
  },
  demo: {
    label: 'A group conversation in Web Chat',
    search: 'Search',
    group: 'Weekend Hike',
    members: '4 members',
    people: { carol: 'Carol', bob: 'Bob', dan: 'Dan' },
    dialogs: [
      { name: 'Weekend Hike', preview: 'Carol: Sticker', time: '17:45' },
      { name: 'Bob Miller', preview: 'New message', time: '17:40' },
      { name: 'Design Team', preview: 'Dan: @You can you review it?', time: '16:02' },
      { name: 'Carol Davis', preview: 'Can I borrow your trekking poles?', time: '15:31' },
    ],
    carol: 'Forecast says sunny all Saturday ☀️',
    me: 'Perfect. I’ll bring the camera this time 📷',
    meReplyTo: 'Forecast says sunny all Saturday ☀️',
    linkTitle: 'Lakeside Loop · 12 km, 3 h 40 min',
    linkDomain: 'trails.example',
    typing: 'Bob is typing',
    composer: 'Message',
  },
  features: {
    title: 'Everything you expect from a modern messenger',
    lead: 'Built to feel like a native app, with the privacy and control of running it yourself.',
    items: [
      {
        title: 'Private chats and groups',
        body: 'Groups of up to 20 members with replies, edits, recall, reactions, pinned messages, forwarding, mentions, read receipts, typing and online status.',
      },
      {
        title: 'End-to-end encrypted secret chats',
        body: 'Secret chats use MLS across all of both people’s devices, media included. The server only stores ciphertext, and a 60-digit safety code reveals any inserted device.',
      },
      {
        title: 'Voice and video calls',
        body: 'One-to-one calls go peer to peer with a TURN relay as fallback; group calls run on Cloudflare Realtime SFU. Screen sharing, picture-in-picture and AI noise suppression.',
      },
      {
        title: 'Rich media',
        body: 'Photo and video albums transcoded in the browser, files, voice messages up to five minutes, up to 200 saved stickers and link preview cards.',
      },
      {
        title: 'Local-first and offline',
        body: 'Every message lives in SQLite in your browser (WASM on OPFS). The app opens instantly, works offline, syncs across devices and tabs, and searches on the device.',
      },
      {
        title: 'An installable app',
        body: 'A PWA with Web Push notifications, an app badge, the system share sheet and a picture-in-picture chat window.',
      },
      {
        title: 'Your identity provider',
        body: 'Sign in with any OpenID Connect provider through better-auth. Manage devices, contacts, aliases, blocking and invite links.',
      },
    ],
  },
  architecture: {
    title: 'One Worker. Two kinds of Durable Objects.',
    lead: 'The whole backend fits in a single Cloudflare Worker. State lives in SQLite-backed Durable Objects, so there are no servers, queues or caches to run.',
    browser: 'Your browser',
    browserItems: ['React app', 'Sync worker', 'SQLite in OPFS'],
    worker: 'Cloudflare Worker',
    workerItems: ['Static app', 'API (Hono)', 'better-auth', 'WebSocket'],
    userDo: 'UserDO · one per user: dialogs, devices, connections',
    chatDo: 'ChatDO · one per chat: message log, members',
    d1: 'D1 · accounts and sessions',
    r2: 'R2 · photos, videos, files and stickers',
    r2Items: ['Presigned uploads from the browser', 'Downloads from the bucket’s custom domain'],
    notes: [
      {
        title: 'One hibernating WebSocket',
        body: 'Each device keeps a single connection to its UserDO. Idle connections hibernate and cost nothing.',
      },
      {
        title: 'Write fan-out for small groups',
        body: 'A ChatDO appends each message once and fans it out to the members’ UserDOs, so syncing a dialog list is a single read.',
      },
      {
        title: 'Media never touches the Worker',
        body: 'Uploads go to R2 with presigned URLs and downloads come straight from the bucket’s custom domain. Thumbnails and video transcoding happen in the browser.',
      },
    ],
  },
  budget: {
    title: 'Designed around the free plan',
    lead: 'Every hot path is measured in Durable Object requests and SQLite row writes, the tightest free-plan limits, and tested to stay within them.',
    items: [
      { value: '$0', label: 'to run a small community on the Workers Free plan' },
      { value: '4', label: 'row writes to send a private message' },
      { value: '0', label: 'Worker requests to load media, served straight from R2' },
      { value: '20', label: 'members per group, so fan-out stays bounded' },
    ],
  },
  deploy: {
    title: 'Deploy your own in minutes',
    lead: 'All you need is a Cloudflare account, a domain on Cloudflare for media, and an OpenID Connect provider.',
    steps: [
      {
        title: 'Click Deploy to Cloudflare',
        body: 'Cloudflare copies the repository into your account, creates the D1 database, the R2 bucket and the Durable Objects, and deploys to workers.dev.',
      },
      {
        title: 'Connect your identity provider and R2',
        body: 'Register a client with your provider, then give the media bucket a custom domain, CORS rules and an API token.',
      },
      {
        title: 'Fill in the vars and secrets',
        body: 'Add the values to wrangler.jsonc and the secrets, push, and check /api/auth/ok. Calls and notifications are optional extras.',
      },
    ],
    button: 'Deploy to Cloudflare',
    manual: 'Read the deployment guide',
  },
  faq: {
    title: 'Frequently asked questions',
    items: [
      {
        q: 'What is Web Chat?',
        a: 'Web Chat is an open-source, Telegram-style chat app for the web. It runs entirely on the Cloudflare developer platform (Workers, Durable Objects, D1 and R2) and is released under the Apache-2.0 license.',
      },
      {
        q: 'Is it really free to run?',
        a: 'Web Chat is designed to fit the Cloudflare Workers Free plan for a small community, such as a family, a team or a group of friends. Static assets are free and unlimited, idle WebSockets hibernate, and media is served from R2 without invoking the Worker. The same code runs unchanged on the paid plan when a community outgrows it.',
      },
      {
        q: 'How do I host my own instance?',
        a: 'Click Deploy to Cloudflare on GitHub, register a client with your OpenID Connect provider, set up the R2 bucket’s custom domain, CORS and API token, then fill in the vars and secrets. The README walks through every step, including a manual deployment with Wrangler.',
      },
      {
        q: 'Are messages end-to-end encrypted?',
        a: 'Secret chats are end-to-end encrypted with MLS across all of both people’s devices, media included, and the server only stores ciphertext. Regular private chats and groups are encrypted in transit and stored in the Cloudflare account of whoever runs the instance, so search, multi-device sync and history work without extra steps.',
      },
      {
        q: 'Does it work offline?',
        a: 'Yes. Messages are stored in SQLite in the browser, so the app opens without a network, shows your history, queues messages you send and delivers them when you reconnect. Search also runs on the device.',
      },
      {
        q: 'Is Web Chat affiliated with Telegram?',
        a: 'No. Web Chat is an independent open-source project inspired by the Telegram user experience. It does not use Telegram’s servers or accounts.',
      },
      {
        q: 'How do people sign in?',
        a: 'Through an OpenID Connect provider that you choose, such as your own identity server. Web Chat stores no passwords. Each browser you sign in on becomes a device that you can remove from the settings.',
      },
    ],
  },
  footer: {
    tagline: 'Open-source chat on Cloudflare Workers.',
    license: 'Apache-2.0 License',
    source: 'Source code',
    docs: 'Architecture docs',
  },
}

const zh: Copy = {
  title: 'Web Chat · 运行在 Cloudflare Workers 上的开源类 Telegram 聊天应用',
  description:
    'Web Chat 是一个开源的类 Telegram 聊天应用，完全运行在 Cloudflare Workers、Durable Objects、D1 与 R2 上：群组、端到端加密的秘密聊天、语音与视频通话、媒体和离线优先的同步。用免费套餐就能部署你自己的。',
  ogTitle: 'Web Chat · 用 Cloudflare 免费套餐部署你自己的聊天应用',
  ogImageAlt: 'Web Chat：一个带回复、回应、语音消息和链接预览的群组会话',
  nav: { skip: '跳到正文', features: '功能', architecture: '架构', deploy: '部署', faq: '常见问题', signIn: '打开 Web Chat', switchLang: 'English' },
  hero: {
    eyebrow: '开源 · Apache-2.0',
    title: '你自己的类 Telegram 聊天，跑在 Cloudflare 免费套餐上',
    lead: '群组、端到端加密的秘密聊天、通话、语音消息与贴纸。消息存在你的浏览器里，在多台设备间同步；整个服务端只是一个 Worker，一键即可部署。',
    open: '打开 Web Chat',
    deploy: '部署你自己的',
    source: '查看源码',
    facts: ['Workers 免费套餐', '离线可用', '用任意 OpenID Connect 身份源登录'],
  },
  demo: {
    label: 'Web Chat 里的一个群组会话',
    search: '搜索',
    group: '周末徒步',
    members: '4 位成员',
    people: { carol: '小林', bob: '老周', dan: '阿杰' },
    dialogs: [
      { name: '周末徒步', preview: '小林：贴纸', time: '17:45' },
      { name: '老周', preview: 'New message', time: '17:40' },
      { name: '设计组', preview: '阿杰：@你 帮忙看一下？', time: '16:02' },
      { name: '小林', preview: '登山杖能借我用一下吗？', time: '15:31' },
    ],
    carol: '天气预报说周六一整天都是晴天 ☀️',
    me: '太好了，这次我带上相机 📷',
    meReplyTo: '天气预报说周六一整天都是晴天 ☀️',
    linkTitle: '湖畔环线 · 12 公里，3 小时 40 分',
    linkDomain: 'trails.example',
    typing: '老周正在输入',
    composer: '消息',
  },
  features: {
    title: '现代即时通讯该有的，这里都有',
    lead: '用起来像原生应用，同时拥有自己部署带来的隐私与掌控。',
    items: [
      {
        title: '私聊与群组',
        body: '群组最多 20 人，支持回复、编辑、撤回、回应、置顶消息、转发、@提及、已读回执、输入中与在线状态。',
      },
      {
        title: '端到端加密的秘密聊天',
        body: '秘密聊天在双方所有设备之间使用 MLS 加密，媒体也不例外。服务端只保存密文，60 位安全码可以发现被插入的设备。',
      },
      {
        title: '语音与视频通话',
        body: '一对一通话点对点直连，不通时经 TURN 中转；群组通话基于 Cloudflare Realtime SFU。支持屏幕共享、画中画与 AI 降噪。',
      },
      {
        title: '丰富的媒体',
        body: '在浏览器里转码的图片与视频相册、文件、最长 5 分钟的语音消息、最多 200 张的我的贴纸，以及链接预览卡片。',
      },
      {
        title: '本地优先，离线可用',
        body: '每条消息都存在浏览器里的 SQLite（WASM + OPFS）中。打开即用、断网可用，在多台设备与多个标签页间同步，搜索在本机完成。',
      },
      {
        title: '可安装的应用',
        body: 'PWA，支持 Web Push 推送通知、应用角标、系统分享面板和画中画聊天小窗。',
      },
      {
        title: '你自己的身份源',
        body: '通过 better-auth 用任意 OpenID Connect 身份源登录。管理设备、联系人、备注名、拉黑与邀请链接。',
      },
    ],
  },
  architecture: {
    title: '一个 Worker，两种 Durable Object',
    lead: '整个服务端就是一个 Cloudflare Worker。状态存放在基于 SQLite 的 Durable Object 里，不需要运维服务器、队列或缓存。',
    browser: '你的浏览器',
    browserItems: ['React 应用', '同步 Worker', 'OPFS 中的 SQLite'],
    worker: 'Cloudflare Worker',
    workerItems: ['静态应用', 'API（Hono）', 'better-auth', 'WebSocket'],
    userDo: 'UserDO · 每个用户一个：对话、设备、连接',
    chatDo: 'ChatDO · 每个会话一个：消息日志、成员',
    d1: 'D1 · 账号与登录会话',
    r2: 'R2 · 图片、视频、文件与贴纸',
    r2Items: ['浏览器用预签名地址直传', '下载走存储桶的自定义域名'],
    notes: [
      {
        title: '一条可休眠的 WebSocket',
        body: '每台设备只和自己的 UserDO 保持一条连接。空闲的连接会休眠，不产生费用。',
      },
      {
        title: '小群组写扩散',
        body: 'ChatDO 把每条消息写一次，再扇出到各成员的 UserDO，同步对话列表只需要读一次。',
      },
      {
        title: '媒体不经过 Worker',
        body: '上传用预签名地址直传 R2，下载直接走存储桶的自定义域名。缩略图与视频转码都在浏览器里完成。',
      },
    ],
  },
  budget: {
    title: '围绕免费套餐设计',
    lead: '每条热路径都按免费套餐里最紧的两项（Durable Object 请求数与 SQLite 行写入）计量，并由测试保证不超出。',
    items: [
      { value: '$0', label: '在 Workers 免费套餐上运行一个小型社区' },
      { value: '4', label: '发一条私聊消息的行写入次数' },
      { value: '0', label: '加载媒体所需的 Worker 请求，直接由 R2 提供' },
      { value: '20', label: '每个群组的成员上限，扇出开销有界' },
    ],
  },
  deploy: {
    title: '几分钟部署你自己的',
    lead: '你只需要一个 Cloudflare 账号、一个托管在 Cloudflare 上用于媒体的域名，以及一个 OpenID Connect 身份源。',
    steps: [
      {
        title: '点击 Deploy to Cloudflare',
        body: 'Cloudflare 把仓库复制到你的账号下，创建 D1 数据库、R2 存储桶与 Durable Object，并部署到 workers.dev。',
      },
      {
        title: '接入身份源与 R2',
        body: '在身份源注册一个客户端，再给媒体存储桶配置自定义域名、CORS 规则与 API 令牌。',
      },
      {
        title: '填写变量与机密',
        body: '把配置写进 wrangler.jsonc、设置机密并推送，然后打开 /api/auth/ok 检查。通话与推送通知是可选的。',
      },
    ],
    button: 'Deploy to Cloudflare',
    manual: '阅读部署指南',
  },
  faq: {
    title: '常见问题',
    items: [
      {
        q: 'Web Chat 是什么？',
        a: 'Web Chat 是一个开源的类 Telegram 网页聊天应用，完全运行在 Cloudflare 开发者平台（Workers、Durable Objects、D1 与 R2）上，以 Apache-2.0 许可证发布。',
      },
      {
        q: '运行真的免费吗？',
        a: 'Web Chat 按 Cloudflare Workers 免费套餐设计，适合家人、团队或朋友圈这样的小型社区。静态资源免费且不限量，空闲的 WebSocket 会休眠，媒体直接由 R2 提供、不经过 Worker。社区超出免费额度后，同一份代码无需改动即可运行在付费套餐上。',
      },
      {
        q: '怎么部署自己的实例？',
        a: '在 GitHub 上点击 Deploy to Cloudflare，在你的 OpenID Connect 身份源注册客户端，给 R2 存储桶配置自定义域名、CORS 与 API 令牌，再填写变量与机密即可。README 里有每一步的说明，也包括用 Wrangler 手动部署。',
      },
      {
        q: '消息是端到端加密的吗？',
        a: '秘密聊天在双方所有设备之间使用 MLS 端到端加密，媒体也包括在内，服务端只保存密文。普通私聊与群组在传输中加密，存放在部署者自己的 Cloudflare 账号里，因此搜索、多设备同步与历史记录无需额外操作。',
      },
      {
        q: '可以离线使用吗？',
        a: '可以。消息存放在浏览器里的 SQLite 中，没有网络时也能打开应用、查看历史；离线时发送的消息会排队，恢复连接后自动送达。搜索同样在本机完成。',
      },
      {
        q: 'Web Chat 和 Telegram 有关系吗？',
        a: '没有。Web Chat 是一个独立的开源项目，交互上借鉴了 Telegram 的体验，不使用 Telegram 的服务器或账号。',
      },
      {
        q: '用户怎么登录？',
        a: '通过你选择的 OpenID Connect 身份源登录，例如你自己的身份服务器。Web Chat 不保存密码。每个登录过的浏览器都是一台设备，可以在设置里移除。',
      },
    ],
  },
  footer: {
    tagline: '运行在 Cloudflare Workers 上的开源聊天应用。',
    license: 'Apache-2.0 许可证',
    source: '源码',
    docs: '架构文档',
  },
}

export const COPY: Record<Lang, Copy> = { en, zh }
