import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  IDENTITY_ZOOM,
  clampPan,
  distance,
  isDoubleTap,
  isZoomed,
  midpoint,
  scaleFromWheel,
  swipeDirection,
  toggleZoom,
  zoomAt,
  type Point,
  type ZoomState,
} from '@/lib/image-zoom'

interface ZoomableImageProps {
  children: ReactNode
  className?: string
  /** Called for a horizontal swipe at 1x zoom (1 = next, -1 = previous). */
  onSwipe?: (direction: 1 | -1) => void
}

/**
 * Pinch-to-zoom, drag-to-pan, double-tap and wheel zoom around any child.
 * Uses pointer events with `touch-action: none` so iOS Safari does not
 * swallow the gesture (the page viewport is locked via the viewport meta).
 */
export function ZoomableImage({
  children,
  className,
  onSwipe,
}: ZoomableImageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<ZoomState>(IDENTITY_ZOOM)
  const zoomRef = useRef(zoom)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ dist: number; zoom: ZoomState } | null>(null)
  const drag = useRef<{ start: Point; origin: ZoomState } | null>(null)
  const lastTap = useRef<{ time: number; point: Point } | null>(null)
  const moved = useRef(false)

  const apply = useCallback((next: ZoomState) => {
    zoomRef.current = next
    setZoom(next)
  }, [])

  const box = () => {
    const rect = ref.current?.getBoundingClientRect()
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 }
  }

  /** Pointer position relative to the element center. */
  const local = (clientX: number, clientY: number): Point => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: clientX - (rect.left + rect.width / 2),
      y: clientY - (rect.top + rect.height / 2),
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ref.current?.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved.current = false
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      pinch.current = { dist: distance(a, b), zoom: zoomRef.current }
      drag.current = null
    } else if (pointers.current.size === 1) {
      drag.current = {
        start: { x: e.clientX, y: e.clientY },
        origin: zoomRef.current,
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()] as [Point, Point]
      const mid = midpoint(a, b)
      const start = pinch.current
      const ratio = distance(a, b) / (start.dist || 1)
      apply(
        zoomAt(start.zoom, start.zoom.scale * ratio, local(mid.x, mid.y), box())
      )
      moved.current = true
    } else if (drag.current) {
      const dx = e.clientX - drag.current.start.x
      const dy = e.clientY - drag.current.start.y
      if (Math.hypot(dx, dy) > 4) moved.current = true
      if (isZoomed(drag.current.origin)) {
        apply(
          clampPan(
            {
              scale: drag.current.origin.scale,
              x: drag.current.origin.x + dx,
              y: drag.current.origin.y + dy,
            },
            box()
          )
        )
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const wasSingle = pointers.current.size === 1
    pointers.current.delete(e.pointerId)
    pinch.current = null
    if (pointers.current.size === 1) {
      // Pinch ended with one finger left: continue as a pan from here.
      const [p] = [...pointers.current.values()] as [Point]
      drag.current = { start: p, origin: zoomRef.current }
      return
    }
    const d = drag.current
    drag.current = null
    if (!wasSingle || !d) return
    const end = { x: e.clientX, y: e.clientY }
    if (moved.current) {
      const dir = swipeDirection(
        zoomRef.current,
        end.x - d.start.x,
        end.y - d.start.y
      )
      if (dir !== 0) onSwipe?.(dir)
      return
    }
    const now = Date.now()
    if (isDoubleTap(lastTap.current, now, end)) {
      lastTap.current = null
      apply(toggleZoom(zoomRef.current, local(end.x, end.y), box()))
    } else {
      lastTap.current = { time: now, point: end }
    }
  }

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    pinch.current = null
    drag.current = null
  }

  // Non-passive wheel listener so ctrl+wheel (trackpad pinch) is not also
  // handled as browser page zoom.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const focal = {
        x: e.clientX - (rect.left + rect.width / 2),
        y: e.clientY - (rect.top + rect.height / 2),
      }
      const current = zoomRef.current
      apply(
        zoomAt(current, scaleFromWheel(current.scale, e.deltaY), focal, {
          width: rect.width,
          height: rect.height,
        })
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [apply])

  return (
    <div
      ref={ref}
      data-testid="zoomable-image"
      data-zoom={zoom.scale}
      className={cn(
        'flex items-center justify-center overflow-hidden select-none touch-none',
        className
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div
        className="flex max-h-full max-w-full items-center justify-center will-change-transform"
        style={{
          transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
          cursor: isZoomed(zoom) ? 'grab' : 'zoom-in',
        }}
      >
        {children}
      </div>
    </div>
  )
}
