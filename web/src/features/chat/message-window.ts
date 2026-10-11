// 消息列表的内存窗口：与渲染无关的判定，便于单测。见 docs/architecture/07-client.md § 消息列表

/** 窗口每次扩展的条数 */
export const WINDOW_STEP = 50

/**
 * anchor 为空时是最新窗口：最新的 before 条，后面接着发件箱；
 * 否则是锚定窗口：anchor 之前的 before 条，加上从 anchor 起的 after 条
 */
export type MessageWindow = { anchor: number | null; before: number; after: number }

export const latestWindow = (size = WINDOW_STEP): MessageWindow => ({ anchor: null, before: size, after: 0 })

export const windowAround = (seq: number, before = WINDOW_STEP): MessageWindow => ({ anchor: seq, before, after: WINDOW_STEP })

/**
 * 锚定窗口是否已经包含最新一条，可以转回最新窗口（之后跟随新消息、显示发件箱）。
 * 只看窗口没填满不够：更新的消息可能还没同步到本地，要等本地的消息到达 topSeq
 * @param seqs 当前窗口查询到的已落库消息
 * @param topSeq 对话的最新一条；对话还没同步时为 undefined
 */
export function reachesLatest(win: MessageWindow, seqs: number[], topSeq: number | undefined): boolean {
  if (win.anchor === null || topSeq === undefined) return false
  const newer = seqs.filter((seq) => seq >= win.anchor!).length
  return newer < win.after && seqs.some((seq) => seq >= topSeq)
}
