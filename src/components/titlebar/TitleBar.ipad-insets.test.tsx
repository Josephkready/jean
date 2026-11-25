import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TitleBar } from './TitleBar'

const { mockIsIPadOSStandalone, mockIsMobile } = vi.hoisted(() => ({
  mockIsMobile: vi.fn(() => false),
  mockIsIPadOSStandalone: vi.fn(() => false),
}))

vi.mock('@/lib/platform', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isClientLinux: false,
  isClientMacOS: false,
  isIPadOSStandalone: mockIsIPadOSStandalone,
  openExternal: vi.fn(),
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isNativeApp: () => false,
  updateTargetLabel: () => 'server',
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: mockIsMobile,
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))

vi.mock('@/lib/remote-connections', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRemoteConnections: () => [],
}))

vi.mock('@/components/unread/UnreadBell', () => ({
  UnreadBell: () => <div data-testid="unread-bell" />,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
}))

vi.mock('./LinuxWindowControls', () => ({
  LinuxWindowControls: () => null,
}))

vi.mock('./MinimizedCliUpdate', () => ({
  MinimizedCliUpdate: () => null,
}))

vi.mock('./ThemeToggle', () => ({
  ThemeToggle: () => null,
}))

describe('TitleBar iPadOS standalone PWA insets (issue #58)', () => {
  beforeEach(() => {
    mockIsIPadOSStandalone.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('adds safe-area-top padding and reserves 76px top-left traffic-light clearance on iPadOS standalone PWA', () => {
    mockIsIPadOSStandalone.mockReturnValue(true)
    const { container } = render(<TitleBar />)

    const outer = container.firstElementChild as HTMLElement
    expect(outer.className).toContain('pt-[var(--safe-area-top)]')

    // Jean corner logo must be hidden so iPadOS traffic lights do not overlap it
    expect(screen.queryByAltText('Jean')).toBeNull()

    // Left sidebar button wrapper starts at pl-[76px] after iPadOS traffic lights
    const leftBtn = screen.getByRole('button', { name: /left sidebar/i })
    expect(leftBtn.parentElement?.className).toContain('pl-[76px]')
  })

  it('keeps normal pl-9 inset and Jean corner logo in standard desktop web browser', () => {
    mockIsIPadOSStandalone.mockReturnValue(false)
    const { container } = render(<TitleBar />)

    const outer = container.firstElementChild as HTMLElement
    expect(outer.className).toContain('pt-[var(--safe-area-top)]')

    expect(screen.getByAltText('Jean')).toBeInTheDocument()

    const leftBtn = screen.getByRole('button', { name: /left sidebar/i })
    expect(leftBtn.parentElement?.className).toContain('pl-9')
    expect(leftBtn.parentElement?.className).not.toContain('pl-[76px]')
  })

  it('renders no GitHub or Sponsor control in the title bar (issue #38)', () => {
    render(<TitleBar />)

    expect(screen.queryByTestId('open-github-web')).toBeNull()
    expect(screen.queryByRole('button', { name: /github/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /sponsor/i })).toBeNull()
    expect(screen.getByTestId('report-bug')).toBeInTheDocument()
  })

  it('keeps the centre content in flow on mobile so it cannot cover the actions', () => {
    mockIsMobile.mockReturnValue(true)
    const { unmount } = render(<TitleBar />)
    expect(screen.getByTestId('unread-bell').closest('.absolute')).toBeNull()
    unmount()

    mockIsMobile.mockReturnValue(false)
    render(<TitleBar />)
    expect(
      screen.getByTestId('unread-bell').closest('.absolute')
    ).not.toBeNull()
  })
})
