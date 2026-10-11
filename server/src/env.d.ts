// 可选的机密：不在 wrangler.jsonc 与 .dev.vars 里时由 wrangler types 生成不出来，在这里补上
interface Env {
  /** Cloudflare Realtime TURN key，用于签发通话的 TURN 凭据；没有时只用 STUN */
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
  // 群组通话的 Realtime SFU App：App ID 与 App Secret
  SFU_KEY_ID?: string
  SFU_KEY_API_TOKEN?: string
}
