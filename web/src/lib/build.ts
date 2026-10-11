declare const __BUILD__: number

/** 本次构建的时间戳（vite.config.ts 注入），越大越新。标签页与同步 Worker 据此判断谁是旧版本 */
export const BUILD: number = __BUILD__
