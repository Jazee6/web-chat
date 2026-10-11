import { describe, expect, it } from 'vitest'
import { describeAction, describeMedia } from 'shared/text'
import { describeMediaJson } from './media-text'

describe('describeMedia', () => {
  it('counts photos in an album and names a file', () => {
    expect(describeMedia({ kind: 'album', count: 1 })).toBe('Photo')
    expect(describeMedia({ kind: 'album', count: 3 })).toBe('3 photos')
    expect(describeMedia({ kind: 'file', name: 'a.pdf' })).toBe('a.pdf')
  })

  it('gives a voice message its duration', () => {
    expect(describeMedia({ kind: 'voice', duration: 12 })).toBe('Voice message (0:12)')
    expect(describeMedia({ kind: 'voice', duration: 300 })).toBe('Voice message (5:00)')
  })

  it('counts videos apart from photos, and gives a single video its duration', () => {
    expect(describeMedia({ kind: 'album', count: 1, videos: 1, duration: 42 })).toBe('Video (0:42)')
    expect(describeMedia({ kind: 'album', count: 3, videos: 3 })).toBe('3 videos')
    expect(describeMedia({ kind: 'album', count: 3, videos: 1 })).toBe('2 photos, 1 video')
    expect(describeMedia({ kind: 'album', count: 2, videos: 1 })).toBe('1 photo, 1 video')
    expect(describeMedia({ kind: 'album', count: 5, videos: 2 })).toBe('3 photos, 2 videos')
  })

  it('reads a message media array', () => {
    expect(describeMediaJson(JSON.stringify([{ type: 'video', duration: 75 }]))).toBe('Video (1:15)')
    expect(describeMediaJson(JSON.stringify([{ type: 'photo' }, { type: 'video', duration: 5 }]))).toBe('1 photo, 1 video')
    expect(describeMediaJson(JSON.stringify([{ type: 'photo' }, { type: 'photo' }]))).toBe('2 photos')
    expect(describeMediaJson(JSON.stringify([{ type: 'file', name: 'b.zip' }]))).toBe('b.zip')
    expect(describeMediaJson(JSON.stringify([{ type: 'voice', duration: 65 }]))).toBe('Voice message (1:05)')
    expect(describeMediaJson(JSON.stringify([{ type: 'sticker' }]))).toBe('Sticker')
  })
})

describe('describeAction', () => {
  const users = new Map([['b', { name: 'Bob' }]])

  it('writes you in lowercase unless it starts the sentence', () => {
    expect(describeAction({ type: 'member_remove', user_id: 'me' }, 'b', 'me', users)).toBe('Bob removed you')
    expect(describeAction({ type: 'members_add', user_ids: ['b', 'me'] }, 'me', 'me', users)).toBe('You added Bob and you')
    expect(describeAction({ type: 'member_leave', new_owner_id: 'me' }, 'b', 'me', users)).toBe(
      'Bob left the group. You are now the owner',
    )
    expect(describeAction({ type: 'secret_devices', user_ids: ['me', 'b'] }, 'b', 'me', users)).toBe(
      'You and Bob signed in on a new device. The safety code has changed',
    )
  })
})
