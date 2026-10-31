/** Pure zoom/pan math for the image lightboxes (pinch, wheel, double-tap). */

export const MIN_SCALE = 1
export const MAX_SCALE = 5
export const DOUBLE_TAP_SCALE = 2.5
export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_SLOP_PX = 24
export const SWIPE_MIN_PX = 60

export interface ZoomState {
  scale: number
  x: number
  y: number
}

export const IDENTITY_ZOOM: ZoomState = { scale: 1, x: 0, y: 0 }

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function isZoomed(state: ZoomState): boolean {
  return state.scale > MIN_SCALE + 0.01
}

/** Keep the scaled image covering the viewport: pan limited to overflow. */
export function clampPan(state: ZoomState, box: Size): ZoomState {
  const scale = clampScale(state.scale)
  if (scale <= MIN_SCALE) return IDENTITY_ZOOM
  const maxX = (box.width * (scale - 1)) / 2
  const maxY = (box.height * (scale - 1)) / 2
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, state.x)),
    y: Math.min(maxY, Math.max(-maxY, state.y)),
  }
}

/**
 * Zoom to `nextScale` keeping the point under `focal` (relative to the
 * element's center) stationary.
 */
export function zoomAt(
  state: ZoomState,
  nextScale: number,
  focal: Point,
  box: Size
): ZoomState {
  const scale = clampScale(nextScale)
  const ratio = scale / state.scale
  return clampPan(
    {
      scale,
      x: focal.x - (focal.x - state.x) * ratio,
      y: focal.y - (focal.y - state.y) * ratio,
    },
    box
  )
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Double-tap: reset when zoomed, otherwise zoom in on the tap point. */
export function toggleZoom(
  state: ZoomState,
  focal: Point,
  box: Size
): ZoomState {
  return isZoomed(state)
    ? IDENTITY_ZOOM
    : zoomAt(state, DOUBLE_TAP_SCALE, focal, box)
}

/** Wheel / ctrl+wheel (trackpad pinch) delta to a new scale. */
export function scaleFromWheel(scale: number, deltaY: number): number {
  return clampScale(scale * Math.exp(-deltaY * 0.01))
}

/** Horizontal swipe direction (1 = next, -1 = previous) only at 1x zoom. */
export function swipeDirection(
  state: ZoomState,
  dx: number,
  dy: number
): 1 | -1 | 0 {
  if (isZoomed(state)) return 0
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0
  return dx < 0 ? 1 : -1
}

export function isDoubleTap(
  prev: { time: number; point: Point } | null,
  time: number,
  point: Point
): boolean {
  return (
    prev !== null &&
    time - prev.time <= DOUBLE_TAP_MS &&
    distance(prev.point, point) <= DOUBLE_TAP_SLOP_PX
  )
}
