// 部署配置：wrangler.jsonc 的 vars，由 vite.config.ts 在构建（与开发）时注入
import * as deploy from 'virtual:deploy'

/** 媒体桶的自定义域名，见 docs/architecture/05-media.md § 分发 */
export const MEDIA_ORIGIN: string = deploy.MEDIA_ORIGIN

/** Web Push 的 VAPID 公钥（base64url 编码的未压缩 P-256 点），与服务端机密 VAPID_PRIVATE_KEY 成对；空串表示没有配置推送 */
export const VAPID_PUBLIC_KEY: string = deploy.VAPID_PUBLIC_KEY
