import { describe, expect, test } from 'vitest'

import { findMentions, mentionQuery } from './mentions'

describe('mentionQuery', () => {
  test('an @ at the start or after whitespace opens a query up to the caret', () => {
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQuery('hi @bo', 6)).toEqual({ start: 3, query: 'bo' })
    expect(mentionQuery('hi @bo there', 6)).toEqual({ start: 3, query: 'bo' })
  })

  test('no query inside a word, after a space, or for an email address', () => {
    expect(mentionQuery('a@b', 3)).toBeNull()
    expect(mentionQuery('@bob ', 5)).toBeNull()
    expect(mentionQuery('hi', 2)).toBeNull()
  })
})

describe('findMentions', () => {
  const bob = { user_id: 'b', name: 'Bob' }
  const bobSmith = { user_id: 's', name: 'Bob Smith' }

  test('every intact @name counts; deleted ones do not', () => {
    expect(findMentions('@Bob and @Bob', [bob])).toEqual([
      { type: 'mention', offset: 0, length: 4, user_id: 'b' },
      { type: 'mention', offset: 9, length: 4, user_id: 'b' },
    ])
    expect(findMentions('@Bo', [bob])).toEqual([])
  })

  test('the longer name wins where two names overlap', () => {
    expect(findMentions('hi @Bob Smith', [bob, bobSmith])).toEqual([{ type: 'mention', offset: 3, length: 10, user_id: 's' }])
  })
})
