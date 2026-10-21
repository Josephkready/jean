import { describe, expect, it } from 'vitest'
import {
  buildBugReportContext,
  bugReportStatusMessage,
  isFinalBugReportState,
  safeIssueUrl,
} from './bug-report'

describe('buildBugReportContext', () => {
  it('drops empty and missing values and trims the rest', () => {
    expect(
      buildBugReportContext({
        view: 'chat',
        projectName: ' jean ',
        projectPath: '',
        worktreeName: null,
        sessionId: undefined,
        runtime: 'web',
        viewport: '1440x900',
        theme: 'dark',
        clientVersion: '1.0.12',
      })
    ).toEqual({
      view: 'chat',
      projectName: 'jean',
      runtime: 'web',
      viewport: '1440x900',
      theme: 'dark',
      clientVersion: '1.0.12',
    })
  })
})

describe('safeIssueUrl', () => {
  it('allows canonical GitHub issue URLs only', () => {
    expect(safeIssueUrl('https://github.com/Josephkready/jean/issues/12')).toBe(
      'https://github.com/Josephkready/jean/issues/12'
    )
    for (const url of [
      'javascript:alert(1)',
      'http://github.com/Josephkready/jean/issues/12',
      'https://github.com.evil.com/a/b/issues/1',
      'https://github.com/Josephkready/jean/pull/12',
      'https://github.com/Josephkready/jean/issues/12?x=1',
      null,
      undefined,
    ]) {
      expect(safeIssueUrl(url)).toBeNull()
    }
  })
})

describe('bug report status', () => {
  it('stops polling only on filed, failed and uncertain', () => {
    expect(isFinalBugReportState('filed')).toBe(true)
    expect(isFinalBugReportState('failed')).toBe(true)
    expect(isFinalBugReportState('uncertain')).toBe(true)
    expect(isFinalBugReportState('pending-sync')).toBe(false)
    expect(isFinalBugReportState('pending')).toBe(false)
    expect(isFinalBugReportState('retry')).toBe(false)
  })

  it('never tells the user a saved report was lost', () => {
    for (const state of [
      'pending-sync',
      'retry',
      'failed',
      'uncertain',
    ] as const) {
      expect(bugReportStatusMessage(state)).toMatch(/^Report saved/)
    }
  })
})
