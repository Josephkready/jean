import { useEffect, useState } from 'react'

export interface VisualViewportShellState {
  /** Exact visual viewport height (px) when panned or shrunk by OS chrome/keyboard, else null */
  height: number | null
  /** Top offset (px) of the visual viewport within the layout viewport */
  offsetTop: number
}

const DEFAULT_STATE: VisualViewportShellState = {
  height: null,
  offsetTop: 0,
}

/**
 * Compute visual viewport shell overrides from browser window + visualViewport.
 * Ignores active pinch-zoom (`scale > 1.02`) so accessibility zoom still works.
 */
export function computeVisualViewportShellState(): VisualViewportShellState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  const vv = window.visualViewport
  if (!vv) return DEFAULT_STATE

  const scale = vv.scale ?? 1
  if (scale > 1.02) return DEFAULT_STATE

  const offsetTop = vv.offsetTop > 0.5 ? Math.round(vv.offsetTop) : 0
  const heightDiff = Math.abs(window.innerHeight - vv.height)
  const isShrunkOrPanned = vv.height > 0 && (heightDiff > 1 || offsetTop > 0)

  if (!isShrunkOrPanned) return DEFAULT_STATE

  return {
    height: Math.round(vv.height),
    offsetTop,
  }
}

/**
 * Tracks `window.visualViewport` so fixed headers and the main shell remain
 * pinned inside the visible viewport on iOS/iPadOS Safari when a focused input
 * triggers the software keyboard, accessory bar, or focus auto-scroll.
 */
export function useVisualViewportShell(
  enabled: boolean
): VisualViewportShellState {
  const [state, setState] = useState<VisualViewportShellState>(() =>
    enabled ? computeVisualViewportShellState() : DEFAULT_STATE
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!enabled) {
      document.documentElement.style.removeProperty('--vv-offset-top')
      return
    }
    document.documentElement.style.setProperty(
      '--vv-offset-top',
      `${state.offsetTop}px`
    )
    return () => {
      document.documentElement.style.removeProperty('--vv-offset-top')
    }
  }, [enabled, state.offsetTop])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setState(prev =>
        prev.height === null && prev.offsetTop === 0 ? prev : DEFAULT_STATE
      )
      return
    }

    const vv = window.visualViewport
    if (!vv) return

    let rafId: number | null = null
    let settleTimer: number | null = null

    const update = () => {
      if (
        (vv.scale ?? 1) <= 1.02 &&
        (window.scrollX !== 0 || window.scrollY !== 0)
      ) {
        window.scrollTo(0, 0)
      }
      const next = computeVisualViewportShellState()
      setState(prev =>
        prev.height === next.height && prev.offsetTop === next.offsetTop
          ? prev
          : next
      )
    }

    const scheduleUpdate = () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        update()
      })
      if (settleTimer !== null) window.clearTimeout(settleTimer)
      // iOS/iPadOS keyboard & accessory bar animations often finish ~80-100ms after the last event.
      settleTimer = window.setTimeout(update, 100)
    }

    update()

    vv.addEventListener('resize', scheduleUpdate)
    vv.addEventListener('scroll', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('orientationchange', scheduleUpdate)

    return () => {
      vv.removeEventListener('resize', scheduleUpdate)
      vv.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('orientationchange', scheduleUpdate)
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      if (settleTimer !== null) window.clearTimeout(settleTimer)
    }
  }, [enabled])

  return enabled ? state : DEFAULT_STATE
}
