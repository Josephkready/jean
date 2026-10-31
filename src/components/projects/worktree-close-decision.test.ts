import { describe, expect, it } from 'vitest'
import {
  closeRequiresConfirmation,
  decideWorktreeMiddleClose,
  decideSessionMiddleClose,
  isSessionEmpty,
} from './worktree-close-decision'

describe('decideWorktreeMiddleClose', () => {
  it('confirms when confirm_session_close is enabled', () => {
    expect(decideWorktreeMiddleClose(true)).toBe('confirm')
  })

  it('confirms when the preference is undefined (defaults to on)', () => {
    expect(decideWorktreeMiddleClose(undefined)).toBe('confirm')
  })

  it('closes immediately when confirm_session_close is disabled', () => {
    expect(decideWorktreeMiddleClose(false)).toBe('close')
  })

  it('closes immediately when the bypass modifier is held, even with confirmation on', () => {
    expect(decideWorktreeMiddleClose(true, true)).toBe('close')
  })

  it('still confirms with confirmation on when the bypass is not held', () => {
    expect(decideWorktreeMiddleClose(true, false)).toBe('confirm')
  })
})

describe('decideSessionMiddleClose', () => {
  it('confirms when removing the last non-empty session with confirmation on', () => {
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 1,
        sessionIsEmpty: false,
        confirmSessionClose: true,
      })
    ).toBe('confirm')
  })

  it('confirms when removing the last non-empty session and preference is undefined', () => {
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 1,
        sessionIsEmpty: false,
        confirmSessionClose: undefined,
      })
    ).toBe('confirm')
  })

  it('deletes the last non-empty session when confirmation is disabled', () => {
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 1,
        sessionIsEmpty: false,
        confirmSessionClose: false,
      })
    ).toBe('delete')
  })

  it('deletes the last session without confirming when it is empty', () => {
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 1,
        sessionIsEmpty: true,
        confirmSessionClose: true,
      })
    ).toBe('delete')
  })

  it('confirms non-empty sessions even when other sessions remain (issue #56)', () => {
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 3,
        sessionIsEmpty: false,
        confirmSessionClose: true,
      })
    ).toBe('confirm')
  })

  it('deletes without confirming when other sessions remain (empty)', () => {
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 2,
        sessionIsEmpty: true,
        confirmSessionClose: true,
      })
    ).toBe('delete')
  })

  it('confirms a non-empty session even when count is 0 (stale/empty list edge)', () => {
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 0,
        sessionIsEmpty: false,
        confirmSessionClose: true,
      })
    ).toBe('confirm')
  })

  it('deletes a non-empty non-last session when confirmation is disabled', () => {
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 3,
        sessionIsEmpty: false,
        confirmSessionClose: false,
      })
    ).toBe('delete')
  })

  it('deletes when the bypass modifier is held, even with confirmation on', () => {
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 1,
        sessionIsEmpty: false,
        confirmSessionClose: true,
        bypassConfirm: true,
      })
    ).toBe('delete')
  })

  it('still confirms a non-empty session when the bypass is not held', () => {
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 1,
        sessionIsEmpty: false,
        confirmSessionClose: true,
        bypassConfirm: false,
      })
    ).toBe('confirm')
  })
})

describe('isSessionEmpty', () => {
  it('is empty with no messages and no draft', () => {
    expect(isSessionEmpty({ id: 's1', message_count: 0 }, {})).toBe(true)
  })

  it('is empty when the draft has only whitespace', () => {
    expect(isSessionEmpty({ id: 's1' }, { s1: '  \n ' })).toBe(true)
  })

  it('is not empty when an unsent draft exists', () => {
    expect(
      isSessionEmpty({ id: 's1', message_count: 0 }, { s1: 'fix it' })
    ).toBe(false)
  })

  it('ignores drafts of other sessions', () => {
    expect(isSessionEmpty({ id: 's1' }, { s2: 'fix it' })).toBe(true)
  })

  it('is not empty when the session has messages', () => {
    expect(isSessionEmpty({ id: 's1', message_count: 2 }, {})).toBe(false)
  })
})

// Issue #35: Close must just archive, with no confirmation dialog, because
// archiving is recoverable. Only permanent deletion is gated.
describe('close confirmation vs removal behavior (issue #35)', () => {
  it('does not confirm when removal behavior is archive', () => {
    expect(closeRequiresConfirmation(true, 'archive')).toBe(false)
    expect(decideWorktreeMiddleClose(true, false, 'archive')).toBe('close')
    expect(
      decideSessionMiddleClose({
        activeSessionCount: 2,
        sessionIsEmpty: false,
        confirmSessionClose: true,
        removalBehavior: 'archive',
      })
    ).toBe('delete')
  })

  it('does not confirm an explicit archive action even when behavior is delete', () => {
    expect(closeRequiresConfirmation(true, 'delete', true)).toBe(false)
  })

  it('still confirms permanent deletion', () => {
    expect(closeRequiresConfirmation(true, 'delete')).toBe(true)
    expect(closeRequiresConfirmation(undefined, undefined)).toBe(true)
    expect(decideWorktreeMiddleClose(true, false, 'delete')).toBe('confirm')
  })

  it('respects the confirm_session_close opt-out', () => {
    expect(closeRequiresConfirmation(false, 'delete')).toBe(false)
  })
})
