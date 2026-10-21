import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useUIStore } from '@/store/ui-store'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useProjects, useWorktree } from '@/services/projects'
import { useTheme } from '@/hooks/use-theme'
import { useIsMobile } from '@/hooks/use-mobile'
import { isNativeApp } from '@/lib/environment'
import { openExternal } from '@/lib/platform'
import { FALLBACK_APP_VERSION } from '@/lib/app-version'
import { generateId } from '@/lib/uuid'
import {
  BUG_REPORT_MAX_LENGTH,
  BUG_REPORT_MIN_LENGTH,
  buildBugReportContext,
  bugReportStatusMessage,
  getBugReportStatus,
  isFinalBugReportState,
  safeIssueUrl,
  submitBugReport,
  type BugReportStatus,
} from '@/services/bug-report'

const DRAFT_KEY = 'jean:bug-report-draft'
const POLL_INTERVAL_MS = 3000
/** Stop polling after this; the issue-queue worker keeps going on its own. */
const POLL_LIMIT_MS = 2 * 60 * 1000

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeDraft(value: string) {
  try {
    if (value) localStorage.setItem(DRAFT_KEY, value)
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Draft persistence is best effort.
  }
}

export function BugReportDialog() {
  const open = useUIStore(state => state.bugReportOpen)
  const handleOpenChange = useCallback((next: boolean) => {
    useUIStore.getState().setBugReportOpen(next)
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <BugReportForm onClose={() => handleOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function BugReportForm({ onClose }: { onClose: () => void }) {
  const [description, setDescription] = useState(readDraft)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<BugReportStatus | null>(null)
  const [pollTimedOut, setPollTimedOut] = useState(false)

  const activeWorktreeId = useChatStore(state => state.activeWorktreeId)
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)
  const { data: projects } = useProjects()
  const { data: worktree } = useWorktree(activeWorktreeId)
  const { theme } = useTheme()
  const isMobile = useIsMobile()

  const trimmedLength = description.trim().length
  const canSubmit =
    !submitting &&
    trimmedLength >= BUG_REPORT_MIN_LENGTH &&
    trimmedLength <= BUG_REPORT_MAX_LENGTH

  const handleChange = (value: string) => {
    setDescription(value)
    writeDraft(value)
  }

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    // Snapshot context at submit time, so it shows where the user is now.
    const chat = useChatStore.getState()
    const sessionId = activeWorktreeId
      ? chat.activeSessionIds[activeWorktreeId]
      : undefined
    const projectId = worktree?.project_id ?? selectedProjectId
    const project = projects?.find(p => p.id === projectId)
    const context = buildBugReportContext({
      view: activeWorktreeId ? 'chat' : projectId ? 'project-canvas' : 'home',
      projectName: project?.name,
      projectPath: project?.path,
      worktreeName: worktree?.name,
      worktreeBranch: worktree?.branch,
      sessionId,
      backend: sessionId ? chat.selectedBackends[sessionId] : undefined,
      model: sessionId ? chat.selectedModels[sessionId] : undefined,
      executionMode: sessionId ? chat.executionModes[sessionId] : undefined,
      runtime: isNativeApp() ? 'native' : isMobile ? 'web-mobile' : 'web',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      theme,
      clientVersion: FALLBACK_APP_VERSION,
    })

    setSubmitting(true)
    setError(null)
    try {
      const saved = await submitBugReport({
        id: generateId(),
        description: description.trim(),
        context,
      })
      // The report is now saved on the server, so the draft can go.
      writeDraft('')
      setDescription('')
      setReport(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [
    canSubmit,
    activeWorktreeId,
    worktree,
    selectedProjectId,
    projects,
    isMobile,
    theme,
    description,
  ])

  // Poll the saved report until it is filed or needs attention.
  const reportId = report?.id
  const reportFinal = report ? isFinalBugReportState(report.status) : true
  useEffect(() => {
    if (!reportId || reportFinal) return
    const startedAt = Date.now()
    const timer = window.setInterval(async () => {
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        window.clearInterval(timer)
        setPollTimedOut(true)
        return
      }
      try {
        setReport(await getBugReportStatus(reportId))
      } catch {
        // A failed status check never means the saved report was lost.
      }
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [reportId, reportFinal])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  if (report) {
    const issueUrl =
      report.status === 'filed' ? safeIssueUrl(report.issueUrl) : null
    return (
      <>
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription data-testid="bug-report-status">
            {bugReportStatusMessage(report.status)}
            {pollTimedOut &&
              !isFinalBugReportState(report.status) &&
              ' The issue queue continues in the background.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {issueUrl && (
            <Button variant="outline" onClick={() => openExternal(issueUrl)}>
              View issue
              {report.issueNumber ? ` #${report.issueNumber}` : ''}
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        void handleSubmit()
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Report a bug</DialogTitle>
        <DialogDescription>
          What went wrong? The first line becomes the issue title.
        </DialogDescription>
      </DialogHeader>
      <Textarea
        autoFocus
        value={description}
        onChange={event => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={BUG_REPORT_MAX_LENGTH}
        placeholder="Describe what happened and what you expected."
        className="max-h-[50vh] min-h-32"
        aria-label="Bug description"
        data-testid="bug-report-description"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? 'Saving…' : 'Send report'}
        </Button>
      </DialogFooter>
    </form>
  )
}
