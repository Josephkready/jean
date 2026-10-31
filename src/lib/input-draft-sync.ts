/**
 * Merge-safe persistence for chat input drafts (issue #33).
 *
 * A browser profile shares one UI-state file (keyed by client id) across every
 * tab/window, and each page used to overwrite it with a full snapshot of its
 * own in-memory drafts. A stale page that still held a mid-typing draft (e.g.
 * "Can we look at recently opened issues and ") therefore resurrected it after
 * another page had sent the message and cleared the draft.
 *
 * Instead, each page records only the drafts IT changed since its last
 * successful save and applies those edits on top of the persisted drafts.
 * Drafts a page merely restored at load are never rewritten by it.
 */

/** sessionId -> new draft text, or null when the page cleared that draft. */
export type InputDraftChanges = Map<string, string | null>

let pending: InputDraftChanges = new Map()

/** Record the drafts that differ between two store snapshots. */
export function trackInputDraftChanges(
  prev: Record<string, string>,
  next: Record<string, string>
): void {
  if (prev === next) return
  for (const [id, value] of Object.entries(next)) {
    if (prev[id] !== value) pending.set(id, value)
  }
  for (const id of Object.keys(prev)) {
    if (!(id in next)) pending.set(id, null)
  }
}

/** Take (and reset) the changes made since the last drain. */
export function drainInputDraftChanges(): InputDraftChanges {
  const taken = pending
  pending = new Map()
  return taken
}

/** Put back drained changes after a failed save, keeping newer edits. */
export function requeueInputDraftChanges(changes: InputDraftChanges): void {
  for (const [id, value] of changes) {
    if (!pending.has(id)) pending.set(id, value)
  }
}

export function resetInputDraftChangesForTests(): void {
  pending = new Map()
}

/** Apply this page's draft edits on top of the persisted drafts. */
export function mergeInputDrafts(
  persisted: Record<string, string>,
  changes: InputDraftChanges
): Record<string, string> {
  const merged = new Map(Object.entries(persisted))
  for (const [id, value] of changes) {
    if (value === null || value === '') merged.delete(id)
    else merged.set(id, value)
  }
  return Object.fromEntries(merged)
}
