import { describe, expect, it } from 'vitest'
import {
  IDENTITY_ZOOM,
  MAX_SCALE,
  clampPan,
  clampScale,
  isDoubleTap,
  scaleFromWheel,
  swipeDirection,
  toggleZoom,
  zoomAt,
} from './image-zoom'

const box = { width: 400, height: 300 }

describe('image-zoom', () => {
  it('clamps scale to [1, MAX]', () => {
    expect(clampScale(0.3)).toBe(1)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(NaN)).toBe(1)
  })

  it('limits pan to the overflow and resets at 1x', () => {
    expect(clampPan({ scale: 2, x: 999, y: -999 }, box)).toEqual({
      scale: 2,
      x: 200,
      y: -150,
    })
    expect(clampPan({ scale: 1, x: 50, y: 50 }, box)).toEqual(IDENTITY_ZOOM)
  })

  it('keeps the focal point stationary when zooming', () => {
    const next = zoomAt(IDENTITY_ZOOM, 2, { x: 100, y: 0 }, box)
    expect(next).toEqual({ scale: 2, x: -100, y: 0 })
  })

  it('double-tap zooms in then resets', () => {
    const zoomed = toggleZoom(IDENTITY_ZOOM, { x: 0, y: 0 }, box)
    expect(zoomed.scale).toBe(2.5)
    expect(toggleZoom(zoomed, { x: 0, y: 0 }, box)).toEqual(IDENTITY_ZOOM)
  })

  it('only swipes at 1x and for mostly horizontal moves', () => {
    expect(swipeDirection(IDENTITY_ZOOM, -100, 5)).toBe(1)
    expect(swipeDirection(IDENTITY_ZOOM, 100, 5)).toBe(-1)
    expect(swipeDirection(IDENTITY_ZOOM, 100, 90)).toBe(0)
    expect(swipeDirection(IDENTITY_ZOOM, 20, 0)).toBe(0)
    expect(swipeDirection({ scale: 2, x: 0, y: 0 }, -200, 0)).toBe(0)
  })

  it('detects double taps by time and distance', () => {
    const prev = { time: 1000, point: { x: 10, y: 10 } }
    expect(isDoubleTap(prev, 1200, { x: 12, y: 12 })).toBe(true)
    expect(isDoubleTap(prev, 1500, { x: 12, y: 12 })).toBe(false)
    expect(isDoubleTap(prev, 1100, { x: 200, y: 12 })).toBe(false)
    expect(isDoubleTap(null, 1100, { x: 0, y: 0 })).toBe(false)
  })

  it('wheel up zooms in, down zooms out', () => {
    expect(scaleFromWheel(1, -50)).toBeGreaterThan(1)
    expect(scaleFromWheel(2, 50)).toBeLessThan(2)
  })
})
