import { describe, expect, it } from 'vitest'
import { nextTheme, resolveTheme } from './theme-toggle'

describe('theme toggle', () => {
  it('flips explicit themes', () => {
    expect(nextTheme('dark', false)).toBe('light')
    expect(nextTheme('light', true)).toBe('dark')
  })
  it('resolves system theme from the OS preference before flipping', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(nextTheme('system', true)).toBe('light')
    expect(nextTheme('system', false)).toBe('dark')
  })
})
