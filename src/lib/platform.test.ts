import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isIPadOSDevice,
  isIPadOSStandalone,
  isStandaloneDisplayMode,
} from './platform'

const openUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: openUrlMock,
}))

describe('openExternal', () => {
  beforeEach(() => {
    vi.resetModules()
    openUrlMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('opens native/mobile Tauri URLs with the OS default browser opener', async () => {
    openUrlMock.mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: { invoke: vi.fn() },
      open: vi.fn(),
    })
    vi.stubGlobal('navigator', { platform: 'iPhone' })

    const { openExternal } = await import('./platform')

    await openExternal('https://github.com/owner/repo/issues/123')

    expect(openUrlMock).toHaveBeenCalledWith(
      'https://github.com/owner/repo/issues/123'
    )
    expect(openUrlMock).not.toHaveBeenCalledWith(
      'https://github.com/owner/repo/issues/123',
      'inAppBrowser'
    )
    expect(window.open).not.toHaveBeenCalled()
  })

  it('uses a pre-opened web window only outside native Tauri', async () => {
    const preOpenedWindow = { location: { href: '' } } as Window
    vi.stubGlobal('window', {
      open: vi.fn(),
    })
    vi.stubGlobal('navigator', { platform: 'MacIntel' })

    const { openExternal } = await import('./platform')

    await openExternal(
      'https://github.com/owner/repo/pull/456',
      preOpenedWindow
    )

    expect(preOpenedWindow.location.href).toBe(
      'https://github.com/owner/repo/pull/456'
    )
    expect(openUrlMock).not.toHaveBeenCalled()
  })
})

describe('server platform detection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('does not derive server platform flags from the browser platform', async () => {
    vi.stubGlobal('window', { open: vi.fn() })
    vi.stubGlobal('navigator', { platform: 'Win32' })

    const { isMacOS, isWindows, isLinux, getServerPlatform } =
      await import('./platform')

    expect(getServerPlatform()).toBe('linux')
    expect(isWindows).toBe(false)
    expect(isMacOS).toBe(false)
    expect(isLinux).toBe(true)
  })

  it('uses the Jean server platform instead of the browser platform when provided', async () => {
    vi.stubGlobal('window', { open: vi.fn() })
    vi.stubGlobal('navigator', { platform: 'Win32' })

    const platform = await import('./platform')

    platform.setServerPlatform('linux')

    expect(platform.getServerPlatform()).toBe('linux')
    expect(platform.isServerWindows()).toBe(false)
    expect(platform.isWindows).toBe(false)

    platform.setServerPlatform('windows')
    expect(platform.isServerWindows()).toBe(true)
    expect(platform.isWindows).toBe(true)
  })

  it('keeps the native client platform separate from a remote server platform', async () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })

    const platform = await import('./platform')

    platform.setServerPlatform('linux')

    expect(platform.isClientMacOS).toBe(true)
    expect(platform.isClientLinux).toBe(false)
    expect(platform.isMacOS).toBe(false)
    expect(platform.isLinux).toBe(true)
  })

  it('formats shortcuts for the native Mac client when the server is Linux', async () => {
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: { invoke: vi.fn() },
    })
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })

    const platform = await import('./platform')
    platform.setServerPlatform('linux')
    const { formatShortcutDisplay } = await import('@/types/keybindings')

    expect(formatShortcutDisplay('mod+period')).toBe('⌘ + .')
    expect(platform.getModifierSymbol()).toBe('⌘')
  })

  it('uses Ctrl for a Mac web client', async () => {
    vi.stubGlobal('window', { open: vi.fn() })
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })

    const platform = await import('./platform')
    const { formatShortcutDisplay } = await import('@/types/keybindings')

    expect(platform.getModifierSymbol()).toBe('Ctrl')
    expect(formatShortcutDisplay('mod+period')).toBe('Ctrl + .')
  })
})

describe('iPadOS and standalone PWA detection', () => {
  const originalNavigator = globalThis.navigator
  const originalWindow = globalThis.window

  function mockClient({
    userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    platform = 'MacIntel',
    maxTouchPoints = 0,
    standalone,
    displayModeStandalone = false,
    nativeTauri = false,
  }: {
    userAgent?: string
    platform?: string
    maxTouchPoints?: number
    standalone?: boolean
    displayModeStandalone?: boolean
    nativeTauri?: boolean
  }) {
    vi.stubGlobal('navigator', {
      userAgent,
      platform,
      maxTouchPoints,
      ...(standalone !== undefined ? { standalone } : {}),
    })
    const win = {
      matchMedia: vi.fn((query: string) => ({
        matches:
          displayModeStandalone && query.includes('display-mode: standalone'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => false),
      })),
      ...(nativeTauri ? { __TAURI_INTERNALS__: { invoke: vi.fn() } } : {}),
    }
    vi.stubGlobal('window', win)
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalNavigator !== undefined) {
      vi.stubGlobal('navigator', originalNavigator)
    }
    if (originalWindow !== undefined) {
      vi.stubGlobal('window', originalWindow)
    }
  })

  it('detects desktop-UA iPadOS via Macintosh/MacIntel + maxTouchPoints > 1', () => {
    mockClient({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })
    expect(isIPadOSDevice()).toBe(true)
  })

  it('detects legacy iPad UA directly', () => {
    mockClient({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)',
      platform: 'iPad',
      maxTouchPoints: 5,
    })
    expect(isIPadOSDevice()).toBe(true)
  })

  it('does not treat desktop macOS with 0 touch points as iPadOS', () => {
    mockClient({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    })
    expect(isIPadOSDevice()).toBe(false)
  })

  it('detects standalone mode from display-mode media query or navigator.standalone', () => {
    mockClient({ displayModeStandalone: true })
    expect(isStandaloneDisplayMode()).toBe(true)

    mockClient({ standalone: true, displayModeStandalone: false })
    expect(isStandaloneDisplayMode()).toBe(true)

    mockClient({ standalone: false, displayModeStandalone: false })
    expect(isStandaloneDisplayMode()).toBe(false)
  })

  it('returns true for isIPadOSStandalone only on non-native standalone iPadOS', () => {
    mockClient({
      platform: 'MacIntel',
      maxTouchPoints: 5,
      displayModeStandalone: true,
      nativeTauri: false,
    })
    expect(isIPadOSStandalone()).toBe(true)

    mockClient({
      platform: 'MacIntel',
      maxTouchPoints: 5,
      displayModeStandalone: false,
      nativeTauri: false,
    })
    expect(isIPadOSStandalone()).toBe(false)

    mockClient({
      platform: 'MacIntel',
      maxTouchPoints: 5,
      displayModeStandalone: true,
      nativeTauri: true,
    })
    expect(isIPadOSStandalone()).toBe(false)
  })
})
