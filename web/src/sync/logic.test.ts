import { describe, expect, it } from 'vitest'
import { DEDUP_WINDOW_MS } from 'shared/protocol'
import { classify, drain, needsReconcile, randomId, reconnectDelay } from './logic'

describe('classify', () => {
  it('applies the next update in sequence', () => {
    expect(classify(5, 6, 1)).toBe('apply')
    expect(classify(5, 8, 3)).toBe('apply')
  })

  it('skips updates that were already applied', () => {
    expect(classify(5, 5, 1)).toBe('skip')
    expect(classify(5, 3, 1)).toBe('skip')
  })

  it('detects a gap', () => {
    expect(classify(5, 7, 1)).toBe('gap')
  })
})

describe('drain', () => {
  it('applies buffered updates once the gap is filled, in order', () => {
    const pending = [
      { pts: 8, count: 1 },
      { pts: 7, count: 1 },
      { pts: 10, count: 1 },
    ]
    const { ready, waiting, local } = drain(6, pending)
    expect(ready.map((u) => u.pts)).toEqual([7, 8])
    expect(waiting.map((u) => u.pts)).toEqual([10])
    expect(local).toBe(8)
  })

  it('drops updates that are already applied', () => {
    const { ready, waiting, local } = drain(6, [{ pts: 5, count: 1 }, { pts: 6, count: 1 }])
    expect(ready).toEqual([])
    expect(waiting).toEqual([])
    expect(local).toBe(6)
  })
})

describe('needsReconcile', () => {
  const now = 1_000_000_000

  it('resends recent entries directly and reconciles ones near or past the dedup window', () => {
    expect(needsReconcile(now - 1000, now)).toBe(false)
    expect(needsReconcile(now - DEDUP_WINDOW_MS + 60_000, now)).toBe(true)
    expect(needsReconcile(now - DEDUP_WINDOW_MS * 3, now)).toBe(true)
  })
})

describe('reconnectDelay', () => {
  it('grows exponentially up to a cap', () => {
    expect(reconnectDelay(0, 0.5)).toBe(1000)
    expect(reconnectDelay(3, 0.5)).toBe(8000)
    expect(reconnectDelay(20, 0.5)).toBe(30_000)
  })

  it('adds jitter', () => {
    expect(reconnectDelay(0, 0)).toBe(800)
    expect(reconnectDelay(0, 1)).toBe(1200)
  })
})

describe('randomId', () => {
  it('returns a positive safe integer', () => {
    for (let i = 0; i < 100; i++) {
      const id = randomId()
      expect(Number.isSafeInteger(id)).toBe(true)
      expect(id).toBeGreaterThan(0)
    }
  })
})
