import { expect, test } from 'vitest'
import { highlight } from './highlight'

const render = (segments: ReturnType<typeof highlight>) =>
  segments.map((s) => (s.match ? `[${s.text}]` : s.text)).join('')

test('marks every term case-insensitively', () => {
  expect(render(highlight('Hello world, hello', ['hello']))).toBe('[Hello] world, [hello]')
  expect(render(highlight('foo bar baz', ['baz', 'foo']))).toBe('[foo] bar [baz]')
})

test('prefers the longer term when terms overlap', () => {
  expect(render(highlight('abcdef', ['abc', 'abcd']))).toBe('[abcd]ef')
})

test('collapses whitespace', () => {
  expect(render(highlight('one\n\n two', ['two']))).toBe('one [two]')
})

test('trims text far before the first match', () => {
  const body = `${'x'.repeat(50)} needle`
  expect(render(highlight(body, ['needle'], 5))).toBe('…xxxx [needle]')
})

test('does not split a surrogate pair', () => {
  const body = `${'😀'.repeat(10)}needle`
  const out = render(highlight(body, ['needle'], 3))
  expect(out.startsWith('…😀')).toBe(true)
  expect(out.endsWith('[needle]')).toBe(true)
})

test('treats regex characters literally', () => {
  expect(render(highlight('a+b (c)', ['(c)', 'a+b']))).toBe('[a+b] [(c)]')
})

test('no match leaves the text as is', () => {
  expect(render(highlight('text', ['zzz']))).toBe('text')
})
