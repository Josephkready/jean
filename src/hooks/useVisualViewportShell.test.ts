import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisualViewportShell } from './useVisualViewportShell'

describe('useVisualViewportShell', () => {
  let listeners: { resize: Set<() => void>; scroll: Set<() => void> }
  let vvState: {
    height: number
    offsetTop: number
    scale: number
    addEventListener: (type: 'resize' | 'scroll', cb: () => void) => void
    removeEventListener: (type: 'resize' | 'scroll', cb: () => void) => void
  }
  const origInnerHeight = window.innerHeight
  const origVisualViewport = Object.getOwnPropertyDescriptor(
    window,
    'visualViewport'
  )

  beforeEach(() => {
    vi.useFakeTimers()
    listeners = { resize: new Set(), scroll: new Set() }
    vvState = {
      height: 938,
      offsetTop: 0,
      scale: 1,
      addEventListener: (type, cb) => listeners[type]?.add(cb),
      removeEventListener: (type, cb) => listeners[type]?.delete(cb),
    }
    Object.defineProperty(window, 'innerHeight', {
      value: 938,
      configurable: true,
    })
    Object.defineProperty(window, 'visualViewport', {
      value: vvState,
      configurable: true,
    })
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      return window.setTimeout(() => cb(0), 0)
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      window.clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(window, 'innerHeight', {
      value: origInnerHeight,
      configurable: true,
    })
    if (origVisualViewport) {
      Object.defineProperty(window, 'visualViewport', origVisualViewport)
    }
  })

  it('returns null height and 0 offsetTop when visualViewport matches window', () => {
    const { result } = renderHook(() => useVisualViewportShell(true))
    expect(result.current).toEqual({ height: null, offsetTop: 0 })
  })

  it('tracks offsetTop and height when Safari pans/shrinks visualViewport on focus', () => {
    const { result } = renderHook(() => useVisualViewportShell(true))

    act(() => {
      vvState.offsetTop = 38
      vvState.height = 856
      for (const cb of listeners.resize) cb()
      vi.runAllTimers()
    })

    expect(result.current).toEqual({ height: 856, offsetTop: 38 })
    expect(
      document.documentElement.style.getPropertyValue('--vv-offset-top')
    ).toBe('38px')
  })

  it('clears --vv-offset-top on unmount', () => {
    const { unmount } = renderHook(() => useVisualViewportShell(true))

    act(() => {
      vvState.offsetTop = 32
      vvState.height = 860
      for (const cb of listeners.resize) cb()
      vi.runAllTimers()
    })

    expect(
      document.documentElement.style.getPropertyValue('--vv-offset-top')
    ).toBe('32px')

    unmount()
    expect(
      document.documentElement.style.getPropertyValue('--vv-offset-top')
    ).toBe('')
  })

  it('resets offset when user is pinch-zoomed (scale > 1.02)', () => {
    const { result } = renderHook(() => useVisualViewportShell(true))

    act(() => {
      vvState.offsetTop = 50
      vvState.height = 600
      vvState.scale = 1.5
      for (const cb of listeners.scroll) cb()
      vi.runAllTimers()
    })

    expect(result.current).toEqual({ height: null, offsetTop: 0 })
  })

  it('resets accidental layout scrollY drift when visualViewport is panned', () => {
    renderHook(() => useVisualViewportShell(true))
    vvState.offsetTop = 38
    vvState.height = 856
    Object.defineProperty(window, 'scrollY', { value: 24, configurable: true })

    act(() => {
      for (const cb of listeners.scroll) cb()
      vi.runAllTimers()
    })

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('does not snap back an intentional document scroll without a visualViewport pan', () => {
    renderHook(() => useVisualViewportShell(true))
    Object.defineProperty(window, 'scrollY', { value: 24, configurable: true })

    act(() => {
      for (const cb of listeners.scroll) cb()
      vi.runAllTimers()
    })

    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('stays inactive when disabled (native mode)', () => {
    vvState.offsetTop = 38
    vvState.height = 856
    const { result } = renderHook(() => useVisualViewportShell(false))
    expect(result.current).toEqual({ height: null, offsetTop: 0 })
  })
})
