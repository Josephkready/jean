import type { Theme } from '@/lib/theme-context'

/** The theme actually on screen, resolving 'system' via the OS preference. */
export function resolveTheme(
  theme: Theme,
  systemPrefersDark: boolean
): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light'
  return theme
}

/** Theme the toggle switches to: always the opposite of what is on screen. */
export function nextTheme(
  theme: Theme,
  systemPrefersDark: boolean
): 'light' | 'dark' {
  return resolveTheme(theme, systemPrefersDark) === 'dark' ? 'light' : 'dark'
}
