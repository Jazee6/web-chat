/** 把一个 Blob 存到本地（触发浏览器的下载） */
export function downloadBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}
