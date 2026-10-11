/** 视频的地址：键以 video.mp4 结尾（封面是同目录的 preview） */
export function isVideoUrl(url: string) {
  return new URL(url).pathname.endsWith('/video.mp4')
}
