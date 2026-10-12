import { describe, expect, it } from 'vitest'

import { clampView, MAX_SCALE, zoomAt } from './use-zoom'

describe('zoomAt', () => {
  it('缩放时手势中心下的那一点不动', () => {
    const view = zoomAt({ scale: 1, x: 0, y: 0 }, 2, 100, -50)
    expect(view).toEqual({ scale: 2, x: -100, y: 50 })
    // 区域里 (100, -50) 处对应图片上的点，缩放前后在屏幕上的位置相同
    expect((100 - view.x) / view.scale).toBe(100)
  })

  it('缩放倍数限制在 1 到 MAX_SCALE', () => {
    expect(zoomAt({ scale: 2, x: 0, y: 0 }, 0.1, 0, 0).scale).toBe(1)
    expect(zoomAt({ scale: 2, x: 0, y: 0 }, 100, 0, 0).scale).toBe(MAX_SCALE)
  })
})

describe('clampView', () => {
  // 宽图 2:1 铺满 400×400 的区域：400×200
  it('放大后边缘不离开区域', () => {
    expect(clampView({ scale: 2, x: 1000, y: 1000 }, 400, 400, 2)).toEqual({ scale: 2, x: 200, y: 0 })
    expect(clampView({ scale: 4, x: -1000, y: -1000 }, 400, 400, 2)).toEqual({ scale: 4, x: -600, y: -200 })
  })

  it('没放大时居中', () => {
    expect(clampView({ scale: 0.5, x: 30, y: 30 }, 400, 400, 2)).toEqual({ scale: 1, x: 0, y: 0 })
  })
})
