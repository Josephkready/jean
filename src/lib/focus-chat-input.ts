import type { RefObject } from 'react'

function isEditable(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return true
  }
  return el instanceof HTMLElement && el.isContentEditable
}

/**
 * Re-focus the chat input after an async event (a run finishing, a mutation
 * settling) without stealing focus from something the user is typing in.
 *
 * Skips when another editable element (e.g. the bug report textarea) has
 * focus, or when focus is inside an open dialog.
 */
export function focusChatInputUnlessBusy(
  inputRef: RefObject<HTMLTextAreaElement | null>
): void {
  const input = inputRef.current
  if (!input) return
  const active = document.activeElement
  if (active && active !== input) {
    if (isEditable(active)) return
    if (active.closest('[role="dialog"], [role="alertdialog"]')) return
  }
  input.focus()
}
