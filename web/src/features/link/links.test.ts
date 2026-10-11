import { describe, expect, test } from 'vitest'
import { findLinks, inviteCodeOf, linkOnly } from 'shared/text'

describe('linkOnly', () => {
  test('exactly one http(s) link after trimming', () => {
    expect(linkOnly('  https://example.com/a?b=1#c \n')?.href).toBe('https://example.com/a?b=1#c')
    expect(linkOnly('http://example.com')?.href).toBe('http://example.com/')
    expect(linkOnly('HTTPS://EXAMPLE.COM')?.hostname).toBe('example.com')
  })

  test('anything else is not a link-only message', () => {
    for (const text of ['', 'example.com', 'see https://example.com', 'https://a.com https://b.com', 'ftp://example.com', 'https://', 'javascript:alert(1)']) {
      expect(linkOnly(text), text).toBeNull()
    }
  })

  test('the link is kept as typed, trailing punctuation included', () => {
    expect(linkOnly('https://example.com/a.')?.href).toBe('https://example.com/a.')
  })

  test('lookalike domains show up as punycode', () => {
    expect(linkOnly('https://аpple.com')?.hostname).toBe('xn--pple-43d.com')
  })
})

describe('findLinks', () => {
  test('finds links in text and leaves sentence punctuation out', () => {
    const text = 'Read https://example.com/a, then (https://en.wikipedia.org/wiki/Foo_(bar)). Done.'
    expect(findLinks(text).map((l) => text.slice(l.offset, l.offset + l.length))).toEqual([
      'https://example.com/a',
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ])
  })

  test('ignores text without a scheme', () => {
    expect(findLinks('example.com and www.example.com')).toEqual([])
  })
})

describe('inviteCodeOf', () => {
  const code = `${'A'.repeat(22)}.${'B'.repeat(22)}`
  test('only this app’s /join links with a valid code', () => {
    expect(inviteCodeOf(new URL(`https://chat.jaze.top/join/${code}`), 'https://chat.jaze.top')).toBe(code)
    expect(inviteCodeOf(new URL(`https://evil.example/join/${code}`), 'https://chat.jaze.top')).toBeNull()
    expect(inviteCodeOf(new URL('https://chat.jaze.top/join/nope'), 'https://chat.jaze.top')).toBeNull()
    expect(inviteCodeOf(new URL(`https://chat.jaze.top/join/${code}/x`), 'https://chat.jaze.top')).toBeNull()
  })
})
