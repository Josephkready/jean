import { invoke } from '@/lib/transport'

/** Same bounds the backend enforces in `jean-core/src/bug_report.rs`. */
export const BUG_REPORT_MIN_LENGTH = 10
export const BUG_REPORT_MAX_LENGTH = 8000

export type BugReportState =
  | 'pending-sync'
  | 'pending'
  | 'filing'
  | 'retry'
  | 'filed'
  | 'failed'
  | 'uncertain'

export interface BugReportStatus {
  id: string
  status: BugReportState
  issueUrl?: string | null
  issueNumber?: number | null
}

/** UI/app state only. The server adds version, platform and time itself. */
export interface BugReportContextInput {
  view: string
  projectName?: string | null
  projectPath?: string | null
  worktreeName?: string | null
  worktreeBranch?: string | null
  sessionId?: string | null
  backend?: string | null
  model?: string | null
  executionMode?: string | null
  runtime: string
  viewport: string
  theme: string
  clientVersion: string
}

/** Drop empty values so the issue only lists fields that have data. */
export function buildBugReportContext(
  input: BugReportContextInput
): Record<string, string> {
  const context: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.trim()) context[key] = value.trim()
  }
  return context
}

const ISSUE_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/

/** Only canonical GitHub issue URLs may become a link. */
export function safeIssueUrl(url: string | null | undefined): string | null {
  return url && ISSUE_URL_RE.test(url) ? url : null
}

/** Statuses after which polling stops. */
export function isFinalBugReportState(state: BugReportState): boolean {
  return state === 'filed' || state === 'failed' || state === 'uncertain'
}

/** The saved report is never lost, so no state says that it was. */
export function bugReportStatusMessage(state: BugReportState): string {
  switch (state) {
    case 'pending-sync':
      return 'Report saved. It will be sent to GitHub when the issue queue is available.'
    case 'pending':
    case 'filing':
      return 'Report saved. Filing the GitHub issue…'
    case 'retry':
      return 'Report saved. GitHub is delayed; the issue queue will retry.'
    case 'filed':
      return 'Issue filed.'
    case 'failed':
    case 'uncertain':
      return 'Report saved, but filing it needs operator attention.'
  }
}

export function submitBugReport(args: {
  id: string
  description: string
  context: Record<string, string>
}): Promise<BugReportStatus> {
  return invoke<BugReportStatus>('submit_bug_report', args)
}

export function getBugReportStatus(id: string): Promise<BugReportStatus> {
  return invoke<BugReportStatus>('get_bug_report_status', { id })
}
