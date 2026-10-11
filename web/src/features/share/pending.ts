// 标签页侧的待分享内容：/share 页面读出暂存后放在这里，用户选中的会话的输入框取走一次
import { clearShare, type SharedContent } from './stash'

let pending: SharedContent | null = null

export function setPendingShare(content: SharedContent | null) {
  pending = content
}

/** 输入框取走待分享的内容（只有一次），同时删除暂存 */
export function takePendingShare(): SharedContent | null {
  const content = pending
  if (content) void cancelShare()
  return content
}

export async function cancelShare() {
  pending = null
  await clearShare().catch(() => {})
}

/** 例如 "2 files and text" */
export function describeShare({ text, files }: SharedContent) {
  const parts = [files.length === 1 ? '1 file' : files.length > 1 ? `${files.length} files` : null, text ? 'text' : null]
  return parts.filter(Boolean).join(' and ') || 'Nothing'
}
