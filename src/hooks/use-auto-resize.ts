import { useCallback, useEffect, useRef } from 'react'

/**
 * Auto-resize textarea fallback for engines that don't support CSS `field-sizing: content`.
 * WebKitGTK (Tauri on Linux) lacks support — this hook provides a JS-based equivalent.
 *
 * When `field-sizing: content` IS supported (Chrome 123+, Firefox 131+, Safari 18.4+),
 * the hook is a no-op — CSS handles everything.
 */
export function useAutoResize(
  ref: React.RefObject<HTMLTextAreaElement | null>
) {
  // Detect once at mount (client-only app; CSS API available in browser)
  const supportsFieldSizing = useRef(
    typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('field-sizing', 'content')
  )

  const resize = useCallback(() => {
    if (supportsFieldSizing.current) return
    const el = ref.current
    if (!el) return

    // Reset to auto so scrollHeight reflects actual content
    el.style.height = 'auto'

    // Compute max height from CSS (max-height) or fall back to a large value
    const computed = getComputedStyle(el)
    const maxHeight = parseFloat(computed.maxHeight) || el.clientHeight * 10

    if (el.scrollHeight > maxHeight) {
      el.style.height = `${maxHeight}px`
      el.style.overflowY = 'auto'
    } else {
      el.style.height = `${el.scrollHeight}px`
      el.style.overflowY = 'hidden'
    }
  }, [ref])

  useEffect(() => {
    if (supportsFieldSizing.current) return
    const el = ref.current
    if (!el) return

    // Initial sizing
    resize()

    // Listen for user input
    el.addEventListener('input', resize)

    // Re-calc on window resize (viewport-relative max-height may change)
    window.addEventListener('resize', resize)

    // Re-calc when the width changes: a size measured before layout settles
    // (e.g. at width 0) wraps the text and locks in a too-tall height
    let lastWidth = el.clientWidth
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (el.clientWidth === lastWidth) return
            lastWidth = el.clientWidth
            resize()
          })
    observer?.observe(el)

    return () => {
      el.removeEventListener('input', resize)
      window.removeEventListener('resize', resize)
      observer?.disconnect()
    }
  }, [ref, resize])

  return resize
}
