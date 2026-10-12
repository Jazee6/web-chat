/** vite.config.ts 的 deployConfig 插件生成，用 @/lib/deploy 引用 */
declare module 'virtual:deploy' {
  export const MEDIA_ORIGIN: string
  export const VAPID_PUBLIC_KEY: string
}
