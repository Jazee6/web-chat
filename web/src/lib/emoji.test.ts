import { describe, expect, it } from 'vitest'
import { isJumboEmoji } from './emoji'

describe('isJumboEmoji', () => {
  it('accepts one to three emoji in a row', () => {
    for (const text of ['👍', '😀😀', '😀😀😀', '  😀\n']) expect(isJumboEmoji(text), text).toBe(true)
  })

  it('treats modifier, ZWJ, flag, keycap and tag sequences as one emoji', () => {
    for (const text of ['👍🏽', '👨‍👩‍👧‍👦', '🇨🇳', '1️⃣', '❤️', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '🏳️‍🌈👍🏽🇨🇳']) {
      expect(isJumboEmoji(text), text).toBe(true)
    }
  })

  it('rejects more than three, spaces between, other text and text-style symbols', () => {
    for (const text of ['😀😀😀😀', '😀 😀', 'a😀', '😀!', '1', '#', '©', '™', '', '  ']) {
      expect(isJumboEmoji(text), text).toBe(false)
    }
  })
})
