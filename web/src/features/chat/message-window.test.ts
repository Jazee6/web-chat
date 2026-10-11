import { describe, expect, test } from 'vitest'
import { latestWindow, reachesLatest, windowAround } from './message-window'

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe('reachesLatest', () => {
  test('the latest window never converts', () => {
    expect(reachesLatest(latestWindow(), range(1, 10), 10)).toBe(false)
  })

  test('converts once the window holds the newest message', () => {
    // 锚点 100，之后只有 20 条，最新一条 119 已在本地
    expect(reachesLatest(windowAround(100), range(50, 119), 119)).toBe(true)
  })

  test('waits while newer messages are not synced yet', () => {
    // 打开未读很多、还没同步的会话：窗口里只有锚点之前的已读消息
    expect(reachesLatest(windowAround(81, 10), range(71, 80), 160)).toBe(false)
  })

  test('stays anchored while the window is full', () => {
    expect(reachesLatest(windowAround(100), range(50, 149), 149)).toBe(false)
  })

  test('waits for the dialog', () => {
    expect(reachesLatest(windowAround(1), range(1, 3), undefined)).toBe(false)
  })
})
