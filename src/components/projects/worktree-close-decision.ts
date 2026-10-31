/**
 * Pure decision logic for the middle-click close of a worktree row or a
 * conversation (session) row.
 *
 * Kept separate from the heavy `WorktreeItem` component so the branching matrix
 * (confirmation on/off, last vs. multiple sessions, empty vs. non-empty) is
 * unit-testable without rendering the full store/query tree.
 */

/**
 * Whether closing must ask first. Archiving is recoverable (the item can be
 * restored), so when removal behavior is `archive` (or the action is an
 * explicit archive) closing just archives with no dialog (issue #35). Only the
 * permanent `delete` behavior is gated by `confirm_session_close`.
 */
export function closeRequiresConfirmation(
  confirmSessionClose: boolean | undefined,
  removalBehavior: string | undefined,
  explicitArchive = false
): boolean {
  if (confirmSessionClose === false) return false
  if (explicitArchive || removalBehavior === 'archive') return false
  return true
}

export type WorktreeCloseDecision = 'confirm' | 'close'

/**
 * A middle-click on a worktree row confirms before closing unless
 * `confirm_session_close` is explicitly disabled (undefined defaults to on),
 * or the caller held the configured bypass modifier (`bypassConfirm`).
 */
export function decideWorktreeMiddleClose(
  confirmSessionClose: boolean | undefined,
  bypassConfirm = false,
  removalBehavior?: string
): WorktreeCloseDecision {
  if (bypassConfirm) return 'close'
  return closeRequiresConfirmation(confirmSessionClose, removalBehavior)
    ? 'confirm'
    : 'close'
}

export type SessionCloseDecision = 'confirm' | 'delete'

/**
 * Decide whether closing a session (tab X, middle-click, etc.) should prompt.
 *
 * When `confirm_session_close` is enabled (default), any non-empty session
 * confirms before remove — not only the last tab. Confirming only the last tab
 * let a held close shortcut cascade-delete chats with no recovery prompt
 * (GitHub issue #56). Empty sessions still close immediately.
 *
 * `activeSessionCount` is retained for call-site compatibility / future UX.
 */
export function decideSessionMiddleClose(params: {
  activeSessionCount: number
  sessionIsEmpty: boolean
  confirmSessionClose: boolean | undefined
  bypassConfirm?: boolean
  removalBehavior?: string
}): SessionCloseDecision {
  const {
    sessionIsEmpty,
    confirmSessionClose,
    bypassConfirm = false,
    removalBehavior,
  } = params
  if (bypassConfirm) return 'delete'
  if (
    closeRequiresConfirmation(confirmSessionClose, removalBehavior) &&
    !sessionIsEmpty
  ) {
    return 'confirm'
  }
  return 'delete'
}

/**
 * A session is empty when it has no messages and no unsent draft text.
 * A typed but unsent prompt must not be lost without a confirmation.
 */
export function isSessionEmpty(
  session: { id: string; message_count?: number },
  inputDrafts: Record<string, string>
): boolean {
  return !session.message_count && !inputDrafts[session.id]?.trim()
}

export type SessionTabRemovalDecision =
  | { confirm: false }
  | { confirm: true; mode: 'session' }

/**
 * Decide whether removing a session tab prompts, and which dialog mode to use.
 * Archive (preference or explicit) and empty sessions skip the dialog, so the
 * only dialog mode reachable from a session tab is `session` (issue #35).
 */
export function decideSessionTabRemoval(params: {
  confirmSessionClose: boolean | undefined
  removalBehavior: string | undefined
  archive: boolean
  bypassConfirm: boolean
  sessionIsEmpty: boolean
}): SessionTabRemovalDecision {
  const {
    confirmSessionClose,
    removalBehavior,
    archive,
    bypassConfirm,
    sessionIsEmpty,
  } = params
  if (
    bypassConfirm ||
    sessionIsEmpty ||
    !closeRequiresConfirmation(confirmSessionClose, removalBehavior, archive)
  ) {
    return { confirm: false }
  }
  return { confirm: true, mode: 'session' }
}
