/**
 * Whether `target` sits inside a Radix context or dropdown menu portal.
 * Inline rename inputs check this on blur right after opening from a menu item
 * so focus bouncing back to the closing menu does not submit and close edit mode.
 */
export function isClosingMenuFocusTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      '[data-slot="context-menu-content"], [data-slot="dropdown-menu-content"]'
    ) !== null
  )
}

/**
 * One-shot flag set when a closing context/dropdown menu hands focus to an
 * inline rename input. The first blur toward the closing menu is ignored and
 * consumes the flag; no wall-clock window is involved.
 */
export interface RenameFocusHandoff {
  current: boolean
}

/**
 * Returns true (and consumes the handoff) when a rename input blur should be
 * ignored because focus bounced to the closing menu.
 */
export function shouldIgnoreRenameBlur(
  handoff: RenameFocusHandoff,
  relatedTarget: EventTarget | null
): boolean {
  if (handoff.current && isClosingMenuFocusTarget(relatedTarget)) {
    handoff.current = false
    return true
  }
  return false
}
