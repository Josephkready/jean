/**
 * Close (X) button on a session tab. Always visible: hiding it until hover made
 * it invisible on touch-capable tablets wider than the `sm` breakpoint (#48).
 * `text-foreground/70` keeps contrast in both light and dark themes.
 */
export const SESSION_TAB_CLOSE_CLASS =
  'ml-0.5 text-foreground/70 hover:!text-destructive'
