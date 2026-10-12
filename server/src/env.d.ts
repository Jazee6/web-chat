// 可选的机密：.dev.vars.example 里是注释，wrangler types 生成不出来，在这里补上
interface Env {
  /** Web Push 的 VAPID 私钥，与 VAPID_PUBLIC_KEY 成对；没有时浏览器不会订阅推送 */
  VAPID_PRIVATE_KEY?: string
  /** Cloudflare Realtime TURN key，用于签发通话的 TURN 凭据；没有时只用 STUN */
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
  // 群组通话的 Realtime SFU App：App ID 与 App Secret
  SFU_KEY_ID?: string
  SFU_KEY_API_TOKEN?: string
}
