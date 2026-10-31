import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import { ChevronRight, Paperclip, X } from '@/components/icons/reicon'
import { useUIStore } from '@/store/ui-store'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useProjects, useWorktree } from '@/services/projects'
import { useTheme } from '@/hooks/use-theme'
import { useIsMobile } from '@/hooks/use-mobile'
import { isNativeApp } from '@/lib/environment'
import { CLIENT_BUILD_INFO } from '@/lib/build-info'
import { generateId } from '@/lib/uuid'
import { cn } from '@/lib/utils'
import {
  captureDeviceSnapshot,
  formatCliVersions,
} from '@/lib/bug-report-device'
import {
  MAX_SCREENSHOTS,
  blobToBase64,
  compressScreenshot,
  imageFilesFrom,
  jpegName,
  type StagedScreenshot,
} from '@/lib/bug-report-image'
import {
  BUG_REPORT_MAX_LENGTH,
  BUG_REPORT_MIN_LENGTH,
  buildBugReportContext,
  bugReportStatusMessage,
  submitBugReport,
} from '@/services/bug-report'

type SubmitMode = 'again' | 'done'

const DRAFT_KEY = 'jean:bug-report-draft'

/** Status query roots of the CLIs Jean manages, for the `cliVersions` field. */
const CLI_STATUS_KEYS: [string, string][] = [
  ['claude', 'claude-cli'],
  ['codex', 'codex-cli'],
  ['opencode', 'opencode-cli'],
  ['cursor', 'cursor-cli'],
  ['pi', 'pi-cli'],
  ['antigravity', 'antigravity-cli'],
  ['kimi', 'kimi-cli'],
  ['grok', 'grok-cli'],
  ['commandcode', 'commandcode-cli'],
  ['coderabbit', 'coderabbit-cli'],
  ['gh', 'gh-cli'],
]

/** Versions already in the query cache; this never starts a CLI check. */
function cachedCliVersions(queryClient: QueryClient): string {
  return formatCliVersions(
    CLI_STATUS_KEYS.map(([name, root]) => {
      const entry = queryClient
        .getQueriesData<{ version?: string | null }>({
          queryKey: [root, 'status'],
        })
        .find(([, data]) => data?.version)
      return { name, version: entry?.[1]?.version }
    })
  )
}

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
  const [screenshots, setScreenshots] = useState<StagedScreenshot[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<SubmitMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tauriVersion, setTauriVersion] = useState<string | null>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Synchronous mirrors of state so async handlers see the latest values.
  const latestDescriptionRef = useRef(description)
  const inFlightRef = useRef(false)
  const screenshotsRef = useRef(screenshots)
  screenshotsRef.current = screenshots

  const queryClient = useQueryClient()
  // Device facts and cached CLI versions are captured once when the dialog opens.
  const [deviceSnapshot] = useState(captureDeviceSnapshot)
  const [cliVersions] = useState(() => cachedCliVersions(queryClient))
  const activeWorktreeId = useChatStore(state => state.activeWorktreeId)
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)
  const { data: projects } = useProjects()
  const { data: worktree } = useWorktree(activeWorktreeId)
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  // Keyboard hints are native-desktop only (see CLAUDE.md).
  const showKbd = isNativeApp() && !isMobile
  const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

  useEffect(() => {
    if (!isNativeApp()) return
    import('@tauri-apps/api/app')
      .then(({ getTauriVersion }) => getTauriVersion())
      .then(setTauriVersion)
      .catch(() => undefined)
  }, [])

  // Free the thumbnail URLs when the dialog closes.
  useEffect(
    () => () => {
      for (const shot of screenshotsRef.current) {
        URL.revokeObjectURL(shot.previewUrl)
      }
    },
    []
  )

  const sessionId = useChatStore(state =>
    activeWorktreeId ? state.activeSessionIds[activeWorktreeId] : undefined
  )
  const sessionBackend = useChatStore(state =>
    sessionId ? state.selectedBackends[sessionId] : undefined
  )
  const sessionModel = useChatStore(state =>
    sessionId ? state.selectedModels[sessionId] : undefined
  )
  const sessionExecutionMode = useChatStore(state =>
    sessionId ? state.executionModes[sessionId] : undefined
  )

  const buildContext = (session: {
    sessionId?: string
    backend?: string
    model?: string
    executionMode?: string
  }) => {
    const projectId = worktree?.project_id ?? selectedProjectId
    const project = projects?.find(p => p.id === projectId)
    return buildBugReportContext({
      view: activeWorktreeId ? 'chat' : projectId ? 'project-canvas' : 'home',
      projectName: project?.name,
      projectPath: project?.path,
      worktreeName: worktree?.name,
      worktreeBranch: worktree?.branch,
      ...session,
      runtime: isNativeApp() ? 'native' : isMobile ? 'web-mobile' : 'web',
      ...deviceSnapshot,
      theme,
      clientVersion: CLIENT_BUILD_INFO.appVersion,
      webBuildId: CLIENT_BUILD_INFO.webBuildId,
      gitSha: CLIENT_BUILD_INFO.gitSha,
      tauriVersion,
      cliVersions,
    })
  }

  // Submit re-reads the stores so the report shows where the user is at submit time.
  const collectContext = () => {
    const chat = useChatStore.getState()
    const sid = activeWorktreeId
      ? chat.activeSessionIds[activeWorktreeId]
      : undefined
    return buildContext({
      sessionId: sid,
      backend: sid ? chat.selectedBackends[sid] : undefined,
      model: sid ? chat.selectedModels[sid] : undefined,
      executionMode: sid ? chat.executionModes[sid] : undefined,
    })
  }
  // Memoized so typing in the description doesn't rebuild the details list.
  const details = useMemo(
    () =>
      buildContext({
        sessionId,
        backend: sessionBackend,
        model: sessionModel,
        executionMode: sessionExecutionMode,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildContext closes over exactly the listed inputs
    [
      activeWorktreeId,
      worktree,
      projects,
      selectedProjectId,
      theme,
      isMobile,
      tauriVersion,
      deviceSnapshot,
      cliVersions,
      sessionId,
      sessionBackend,
      sessionModel,
      sessionExecutionMode,
    ]
  )

  const trimmedLength = description.trim().length
  const canSubmit =
    !submitting &&
    trimmedLength >= BUG_REPORT_MIN_LENGTH &&
    trimmedLength <= BUG_REPORT_MAX_LENGTH

  const handleChange = (value: string) => {
    latestDescriptionRef.current = value
    setDescription(value)
    writeDraft(value)
  }

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return
    setAttachError(null)
    const free = MAX_SCREENSHOTS - screenshotsRef.current.length
    if (files.length > free) {
      setAttachError(`Up to ${MAX_SCREENSHOTS} screenshots per report.`)
    }
    for (const file of files.slice(0, Math.max(free, 0))) {
      try {
        const blob = await compressScreenshot(file)
        const shot: StagedScreenshot = {
          id: generateId(),
          name: jpegName(file.name || 'screenshot'),
          blob,
          previewUrl: URL.createObjectURL(blob),
        }
        setScreenshots(current => {
          if (current.length >= MAX_SCREENSHOTS) {
            URL.revokeObjectURL(shot.previewUrl)
            return current
          }
          return [...current, shot]
        })
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const removeScreenshot = (id: string) => {
    setScreenshots(current => {
      const shot = current.find(s => s.id === id)
      if (shot) URL.revokeObjectURL(shot.previewUrl)
      return current.filter(s => s.id !== id)
    })
    setAttachError(null)
  }

  const handlePaste = (event: ClipboardEvent) => {
    // Text still lands in the textarea; only image items are staged.
    void addFiles(imageFilesFrom(event.clipboardData.items))
  }

  const handleDrop = (event: DragEvent) => {
    const files = imageFilesFrom(event.dataTransfer.items)
    if (files.length === 0) return
    event.preventDefault()
    void addFiles(files)
  }

  const handleSubmit = async (mode: SubmitMode) => {
    if (!canSubmit || inFlightRef.current) return
    inFlightRef.current = true
    const submittedDraft = description
    const submittedIds = new Set(screenshots.map(s => s.id))
    setSubmitting(mode)
    setError(null)
    try {
      const attachments = await Promise.all(
        screenshots.map(async shot => ({
          name: shot.name,
          data: await blobToBase64(shot.blob),
        }))
      )
      const saved = await submitBugReport({
        id: generateId(),
        description: description.trim(),
        context: collectContext(),
        attachments,
      })
      // The report is now saved on the server, so the draft can go.
      if (latestDescriptionRef.current === submittedDraft) {
        writeDraft('')
        setDescription('')
        latestDescriptionRef.current = ''
      }
      setScreenshots(current => {
        for (const shot of current) {
          if (submittedIds.has(shot.id)) URL.revokeObjectURL(shot.previewUrl)
        }
        return current.filter(s => !submittedIds.has(s.id))
      })
      setAttachError(null)
      toast.success('Bug report saved', {
        description:
          saved.status === 'filed'
            ? bugReportStatusMessage(saved.status)
            : 'It will be filed as a GitHub issue shortly.',
      })
      if (mode === 'done') {
        onClose()
      } else {
        // Fresh empty report, ready for the next one.
        descriptionRef.current?.focus()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      inFlightRef.current = false
      setSubmitting(null)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      // Cmd/Ctrl+Enter = Send & done; add Shift for Send (keep writing).
      void handleSubmit(event.shiftKey ? 'again' : 'done')
    }
  }

  const detailEntries = Object.entries(details)

  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        void handleSubmit('done')
      }}
      onPaste={handlePaste}
      onDragOver={event => event.preventDefault()}
      onDrop={handleDrop}
      className="min-w-0 space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Report a bug</DialogTitle>
        <DialogDescription>
          What went wrong? The first line becomes the issue title.
        </DialogDescription>
      </DialogHeader>
      <Textarea
        ref={descriptionRef}
        autoFocus
        value={description}
        onChange={event => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={BUG_REPORT_MAX_LENGTH}
        placeholder="Describe what happened and what you expected."
        className="max-h-[40vh] min-h-28"
        aria-label="Bug description"
        data-testid="bug-report-description"
      />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {screenshots.map(shot => (
            <div
              key={shot.id}
              className="relative h-16 w-24 overflow-hidden rounded-md border"
              data-testid="bug-report-screenshot"
            >
              <img
                src={shot.previewUrl}
                alt={shot.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeScreenshot(shot.id)}
                className="absolute top-0.5 right-0.5 rounded-full bg-background/90 p-0.5 text-foreground/80 hover:text-foreground"
                aria-label={`Remove ${shot.name}`}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {screenshots.length < MAX_SCREENSHOTS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              data-testid="bug-report-add-screenshot"
            >
              <Paperclip className="size-3.5" />
              Add screenshot
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={event => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void addFiles(files)
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Up to {MAX_SCREENSHOTS} images. You can also paste or drop them here.
        </p>
        {attachError && (
          <p className="text-sm text-destructive">{attachError}</p>
        )}
      </div>

      <details className="group rounded-md border text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-2 text-muted-foreground select-none">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          Details attached ({detailEntries.length})
        </summary>
        <dl
          className="grid max-h-48 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 overflow-y-auto px-3 pb-2"
          data-testid="bug-report-details"
        >
          {detailEntries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd
                className={cn(
                  'break-all',
                  key === 'userAgent' && 'text-[0.7rem]'
                )}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canSubmit}
          onClick={() => void handleSubmit('again')}
          data-testid="bug-report-send"
        >
          {submitting === 'again' ? 'Saving…' : 'Send'}
          {showKbd && <Kbd>⇧{modKey}↵</Kbd>}
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit}
          data-testid="bug-report-send-done"
        >
          {submitting === 'done' ? 'Saving…' : 'Send & done'}
          {showKbd && <Kbd>{modKey}↵</Kbd>}
        </Button>
      </DialogFooter>
    </form>
  )
}
