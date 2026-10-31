import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { BugReportDialog } from './BugReportDialog'
import type * as BugReportService from '@/services/bug-report'
import { bugReportStatusMessage } from '@/services/bug-report'
import type * as EnvironmentModule from '@/lib/environment'
import { useUIStore } from '@/store/ui-store'

const { submitBugReport, toastSuccess } = vi.hoisted(() => ({
  submitBugReport: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
    message: vi.fn(),
  },
}))

vi.mock('@/services/bug-report', async importOriginal => ({
  ...(await importOriginal<typeof BugReportService>()),
  submitBugReport: (...args: unknown[]) => submitBugReport(...args),
}))
vi.mock('@/lib/build-info', () => ({
  CLIENT_BUILD_INFO: { appVersion: 'test', webBuildId: 'w', gitSha: 'g' },
}))
vi.mock('@/services/projects', () => ({
  useProjects: () => ({ data: [] }),
  useWorktree: () => ({ data: undefined }),
}))
vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<typeof EnvironmentModule>()),
  isNativeApp: () => false,
}))

const DESCRIPTION = 'The chat input steals my cursor when a run finishes.'

async function typeReport() {
  const textarea = await screen.findByTestId('bug-report-description')
  fireEvent.change(textarea, { target: { value: DESCRIPTION } })
  return textarea as HTMLTextAreaElement
}

describe('BugReportDialog send buttons (#12)', () => {
  beforeEach(() => {
    localStorage.clear()
    submitBugReport.mockReset()
    submitBugReport.mockResolvedValue({ id: 'r1', status: 'queued' })
    useUIStore.setState({ bugReportOpen: true })
  })

  it('Send submits, resets to an empty report, stays open and refocuses', async () => {
    render(<BugReportDialog />)
    const textarea = await typeReport()

    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.click(screen.getByTestId('bug-report-send'))

    await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1))
    expect(submitBugReport.mock.calls[0]?.[0].description).toBe(DESCRIPTION)
    await waitFor(() => expect(textarea.value).toBe(''))
    expect(useUIStore.getState().bugReportOpen).toBe(true)
    expect(document.activeElement).toBe(textarea)
    expect(localStorage.getItem('jean:bug-report-draft')).toBeNull()
    expect(toastSuccess).toHaveBeenCalledWith(
      'Bug report saved',
      expect.objectContaining({ description: expect.any(String) })
    )
  })

  it('Send & done submits and closes the modal', async () => {
    render(<BugReportDialog />)
    await typeReport()

    fireEvent.click(screen.getByTestId('bug-report-send-done'))

    await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useUIStore.getState().bugReportOpen).toBe(false))
  })

  it('Cmd/Ctrl+Enter sends and closes the modal', async () => {
    render(<BugReportDialog />)
    await typeReport()

    fireEvent.keyDown(screen.getByTestId('bug-report-description'), {
      key: 'Enter',
      ctrlKey: true,
    })

    await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useUIStore.getState().bugReportOpen).toBe(false))
  })

  it('Meta+Enter sends and closes the modal', async () => {
    render(<BugReportDialog />)
    await typeReport()

    fireEvent.keyDown(screen.getByTestId('bug-report-description'), {
      key: 'Enter',
      metaKey: true,
    })

    await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useUIStore.getState().bugReportOpen).toBe(false))
  })

  it('Cmd/Ctrl+Shift+Enter sends, stays open and clears the textarea', async () => {
    render(<BugReportDialog />)
    const textarea = await typeReport()

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true, shiftKey: true })

    await waitFor(() => expect(submitBugReport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(textarea.value).toBe(''))
    expect(useUIStore.getState().bugReportOpen).toBe(true)
  })

  it('shows the filed message when the server reports the report as filed', async () => {
    submitBugReport.mockResolvedValue({ id: 'r2', status: 'filed' })
    render(<BugReportDialog />)
    await typeReport()

    fireEvent.click(screen.getByTestId('bug-report-send'))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Bug report saved', {
        description: bugReportStatusMessage('filed'),
      })
    )
  })

  it('keeps the draft and stays open when saving fails', async () => {
    submitBugReport.mockRejectedValue(new Error('queue down'))
    render(<BugReportDialog />)
    const textarea = await typeReport()

    fireEvent.click(screen.getByTestId('bug-report-send-done'))

    expect(await screen.findByText('queue down')).toBeTruthy()
    expect(textarea.value).toBe(DESCRIPTION)
    expect(useUIStore.getState().bugReportOpen).toBe(true)
  })
})
