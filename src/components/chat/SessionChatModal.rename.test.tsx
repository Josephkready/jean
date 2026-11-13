import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import type { Project, Worktree } from '@/types/projects'
import type { Session } from '@/types/chat'
import { useChatStore } from '@/store/chat-store'
import { SessionChatModal } from './SessionChatModal'

const mocks = vi.hoisted(() => ({
  sessions: [] as Session[],
  renameMutate: vi.fn(),
  isMobile: false,
  isTouch: false,
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mocks.isMobile,
}))

vi.mock('@/hooks/use-touch-device', () => ({
  useIsTouchDevice: () => mocks.isTouch,
}))

vi.mock('@/hooks/useSwipeBack', () => ({
  useSwipeBack: () => ({
    containerRef: { current: null },
    isSwiping: false,
    translateX: 0,
    progress: 0,
    transitionStyle: '',
  }),
}))

vi.mock('@/hooks/useModifierHintsVisible', () => ({
  isModOnlyHeld: () => false,
  useModifierHintsVisible: () => false,
}))

vi.mock('@/hooks/useRemotePicker', () => ({
  useRemotePicker: () => vi.fn(),
  pushNeedsRemotePicker: () => false,
}))

vi.mock('@/hooks/useWorktreeTerminalStatus', () => ({
  useWorktreeTerminalStatus: () => ({ hasActiveTerminal: false }),
}))

vi.mock('@/services/chat', () => ({
  useSessions: () => ({ data: { sessions: mocks.sessions } }),
  useSession: () => ({ data: null, isError: false }),
  useClearSessionHistory: () => ({ mutate: vi.fn() }),
  useRenameSession: () => ({ mutate: mocks.renameMutate }),
  canReconnectSession: () => false,
  reconnectNativeCliSession: vi.fn(),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: {} }),
  usePatchPreferences: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/services/projects', () => ({
  usePackageScripts: () => ({ data: [] }),
}))

vi.mock('@/services/github', () => ({
  useGitHubPRs: () => ({ data: [] }),
  useDependabotAlerts: () => ({ data: [] }),
  useGitHubIssues: () => ({ data: { totalCount: 0 } }),
  useRepositoryAdvisories: () => ({ data: [] }),
  useWorkflowRuns: () => ({ data: { runs: [], failedCount: 0 } }),
}))

vi.mock('@/services/git-status', () => ({
  useGitStatus: () => ({ data: null }),
  performGitSync: vi.fn(),
}))

vi.mock('@/services/gh-cli', () => ({
  ghCliQueryKeys: { auth: () => ['gh-cli', 'auth'] },
  useGhCliAuth: () => ({}),
}))

vi.mock('@/services/glab-cli', () => ({
  useGlabCliAuth: () => ({ data: null }),
}))

vi.mock('@/services/git-provider', () => ({
  providerLabels: () => ({ name: 'GitHub', shortName: 'GH' }),
  useProjectGitProvider: () => ({ data: { provider: 'github' } }),
}))

vi.mock('@/components/projects/useWorktreeMenuActions', () => ({
  useWorktreeMenuActions: () => ({
    showDeleteConfirm: false,
    setShowDeleteConfirm: vi.fn(),
    isBase: false,
    runScripts: [],
    preferences: {},
    handleRun: vi.fn(),
    handleRunCommand: vi.fn(),
    handleOpenInFinder: vi.fn(),
    handleOpenInTerminal: vi.fn(),
    handleOpenInEditor: vi.fn(),
    handleArchiveOrClose: vi.fn(),
    handleDelete: vi.fn(),
  }),
}))

vi.mock('./hooks/useCanvasStoreState', () => ({
  useCanvasStoreState: () => ({}),
}))

vi.mock('./hooks/useSessionArchive', () => ({
  useSessionArchive: () => ({
    handleArchiveSession: vi.fn(),
    handleDeleteSession: vi.fn(),
  }),
}))

vi.mock('./hooks/useOpenInNativeClient', () => ({
  useOpenInNativeClient: () => ({
    openInNativeClient: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('./session-card-utils', () => ({
  createSessionCardDataCache: () => (session: Session) => ({
    session,
    status: 'idle',
  }),
  getResumeCommand: () => null,
  isActionableWaitingStatus: () => false,
  statusConfig: {
    idle: { indicatorStatus: 'idle', indicatorShape: 'dot', label: 'Idle' },
  },
}))

vi.mock('./ChatWindow', () => ({
  ChatWindow: () => <div data-testid="chat-window" />,
}))

vi.mock('./ModalTerminalDrawer', () => ({
  ModalTerminalDrawer: () => null,
}))

vi.mock('@/components/browser/ModalBrowserDrawer', () => ({
  ModalBrowserDrawer: () => null,
}))

vi.mock('./CloseWorktreeDialog', () => ({
  CloseWorktreeDialog: () => null,
}))

vi.mock('./LabelModal', () => ({
  LabelModal: () => null,
}))

vi.mock('./TerminalMagicButton', () => ({
  TerminalMagicButton: () => null,
}))

vi.mock('@/components/open-in/OpenInButton', () => ({
  OpenInButton: () => null,
}))

vi.mock('@/components/open-in/ScriptsButton', () => ({
  ScriptsButton: () => null,
}))

vi.mock('./DevToolsDropdown', () => ({
  DevToolsDropdown: () => null,
}))

const project: Project = {
  id: 'project-1',
  name: 'mind',
  path: '/tmp/mind',
  default_branch: 'main',
  added_at: 0,
  order: 0,
}

const worktree: Worktree = {
  id: 'wt-1',
  project_id: 'project-1',
  name: 'feature',
  path: '/tmp/mind/feature',
  branch: 'feature',
  created_at: 0,
  order: 0,
}

describe('SessionChatModal session renaming (Fixes #57)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mocks.isMobile = false
    mocks.isTouch = false
    mocks.sessions = [
      {
        id: 's1',
        name: 'Session 1',
        order: 0,
        created_at: 0,
        updated_at: 0,
        messages: [],
      },
      {
        id: 's2',
        name: 'Session 2',
        order: 1,
        created_at: 0,
        updated_at: 0,
        messages: [],
      },
    ]
    useChatStore.setState({
      activeSessionIds: { 'wt-1': 's1' },
      sessionLabels: {},
      namingSessionIds: {},
    })
  })

  it('renders and focuses the rename input synchronously from the tab context menu', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <SessionChatModal
        worktreeId="wt-1"
        worktreePath="/tmp/mind/feature"
        worktree={worktree}
        project={project}
        isOpen={true}
        onClose={onClose}
        onRequestCloseWorktree={vi.fn()}
      />
    )

    const tab = screen.getByText('Session 1').closest('[data-session-id="s1"]')
    expect(tab).not.toBeNull()
    expect(tab).toHaveClass('select-none')
    if (!tab) throw new Error('Expected session tab')

    fireEvent.contextMenu(tab)
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: 'Rename session' })
    expect(input).toHaveFocus()
    expect(input).toHaveClass('min-w-24')

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25))
    })
    expect(input).toHaveFocus()

    await user.clear(input)
    await user.type(input, 'Updated tab name{Enter}')

    expect(mocks.renameMutate).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      worktreePath: '/tmp/mind/feature',
      sessionId: 's1',
      newName: 'Updated tab name',
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('supports renaming the active session from the mobile Actions menu', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mocks.isMobile = true
    mocks.isTouch = true

    render(
      <SessionChatModal
        worktreeId="wt-1"
        worktreePath="/tmp/mind/feature"
        worktree={worktree}
        project={project}
        isOpen={true}
        onClose={onClose}
        onRequestCloseWorktree={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename Session' }))

    const input = screen.getByRole('textbox', { name: 'Rename session' })
    expect(input).toHaveFocus()

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25))
    })
    expect(input).toHaveFocus()

    await user.clear(input)
    await user.type(input, 'Mobile renamed{Enter}')

    expect(mocks.renameMutate).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      worktreePath: '/tmp/mind/feature',
      sessionId: 's1',
      newName: 'Mobile renamed',
    })
  })

  it('cancels rename on Escape without closing the modal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <SessionChatModal
        worktreeId="wt-1"
        worktreePath="/tmp/mind/feature"
        worktree={worktree}
        project={project}
        isOpen={true}
        onClose={onClose}
        onRequestCloseWorktree={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByText('Session 1'))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: 'Rename session' })
    await user.type(input, 'Ignored')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox', { name: 'Rename session' })).toBeNull()
    expect(mocks.renameMutate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
