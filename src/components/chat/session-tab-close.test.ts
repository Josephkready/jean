import { describe, expect, it } from 'vitest'
import { SESSION_TAB_CLOSE_CLASS } from './session-tab-close'

describe('SESSION_TAB_CLOSE_CLASS', () => {
  // Regression for Josephkready/jean#48: close buttons were hover-only on >=sm
  // widths, so touch tablets never saw them.
  it('never hides the close button behind hover', () => {
    expect(SESSION_TAB_CLOSE_CLASS).not.toMatch(/opacity-0|group-hover/)
  })
})
