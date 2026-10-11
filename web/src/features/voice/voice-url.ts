/** 语音消息的录音对象：键的文件名为 voice.webm 或 voice.m4a（见 server/src/media.ts）。SW 与播放器共用 */
export function isVoiceUrl(url: string) {
  return /\/voice\.(webm|m4a)$/.test(new URL(url).pathname)
}
