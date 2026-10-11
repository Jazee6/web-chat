import { describe, expect, it } from 'vitest'
import { typingText } from './typing-text'

const users = new Map([
  ['a', { name: 'Ann' }],
  ['b', { name: 'Bob' }],
])

describe('typingText', () => {
  it('私聊只写动作：都在录音时写录音', () => {
    expect(typingText([{ user_id: 'a', action: 'typing' }], null)).toBe('typing…')
    expect(typingText([{ user_id: 'a', action: 'recording' }], null)).toBe('recording voice…')
  })

  it('群组写出名字或人数；有人在打字就写打字', () => {
    expect(typingText([{ user_id: 'a', action: 'recording' }], users)).toBe('Ann is recording voice…')
    expect(
      typingText(
        [
          { user_id: 'a', action: 'recording' },
          { user_id: 'b', action: 'typing' },
        ],
        users,
      ),
    ).toBe('Ann and Bob are typing…')
    expect(
      typingText(
        [
          { user_id: 'a', action: 'recording' },
          { user_id: 'b', action: 'recording' },
          { user_id: 'c', action: 'recording' },
        ],
        users,
      ),
    ).toBe('3 people are recording voice…')
  })
})
