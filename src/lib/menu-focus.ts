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
