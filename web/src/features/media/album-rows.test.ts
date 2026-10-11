import { describe, expect, it } from 'vitest'

import { albumRows } from './album-rows'

describe('albumRows', () => {
  it('每行 2–3 项，最后一行不会只剩一张', () => {
    expect(albumRows(1)).toEqual([1])
    expect(albumRows(2)).toEqual([2])
    expect(albumRows(3)).toEqual([3])
    expect(albumRows(4)).toEqual([2, 2])
    expect(albumRows(5)).toEqual([2, 3])
    expect(albumRows(6)).toEqual([3, 3])
    expect(albumRows(7)).toEqual([2, 2, 3])
    expect(albumRows(8)).toEqual([2, 3, 3])
    expect(albumRows(9)).toEqual([3, 3, 3])
    expect(albumRows(10)).toEqual([2, 2, 3, 3])
  })
})
