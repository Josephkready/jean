import { describe, expect, it } from 'vitest'
import { splitForMiddleTruncate } from './middle-truncate'

describe('splitForMiddleTruncate', () => {
  it('does not split short values', () => {
    expect(splitForMiddleTruncate('fuzzy-tiger')).toBeNull()
    expect(splitForMiddleTruncate('a'.repeat(14))).toBeNull()
  })

  it('starts the tail on a word when a break is near the cut', () => {
    expect(splitForMiddleTruncate('t3/clone-remote-machine')).toEqual({
      head: 't3/clone-remote-',
      tail: 'machine',
    })
  })

  it('takes a longer tail when no shorter word start exists', () => {
    expect(splitForMiddleTruncate('feat-add-websocketfixes')).toEqual({
      head: 'feat-add-',
      tail: 'websocketfixes',
    })
  })

  it('keeps the default tail when no word break is near', () => {
    expect(splitForMiddleTruncate('abcdefghijklmnopqrstuvwxyz')).toEqual({
      head: 'abcdefghijklmnop',
      tail: 'qrstuvwxyz',
    })
  })

  it('does not split inside a surrogate pair', () => {
    expect(splitForMiddleTruncate('🚀rocket-launch-sequence')).toEqual({
      head: '🚀rocket-launch-',
      tail: 'sequence',
    })
  })
})
