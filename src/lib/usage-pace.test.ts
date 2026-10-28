import { describe, expect, it } from 'vitest'
import { computeUsagePace, HOUR_SECONDS } from './usage-pace'

const WINDOW = 5 * HOUR_SECONDS
const NOW_MS = 1_800_000_000_000

/** Reset time (seconds) for a window with `elapsedHours` already passed. */
function resetsAfter(elapsedHours: number): number {
  return (NOW_MS + (5 - elapsedHours) * HOUR_SECONDS * 1000) / 1000
}

function paceAt(usedPercent: number, resetsAt: number) {
  const pace = computeUsagePace(usedPercent, resetsAt, WINDOW, NOW_MS)
  if (!pace) throw new Error('expected a pace')
  return pace
}

describe('computeUsagePace', () => {
  it('returns null without a reset time or window length', () => {
    expect(computeUsagePace(20, null, WINDOW, NOW_MS)).toBeNull()
    expect(computeUsagePace(20, resetsAfter(1), null, NOW_MS)).toBeNull()
  })

  it('returns null once the window has already reset', () => {
    expect(computeUsagePace(20, NOW_MS / 1000 - 60, WINDOW, NOW_MS)).toBeNull()
  })

  it('projects usage at reset from the average rate', () => {
    const pace = paceAt(20, resetsAfter(2.5))
    expect(pace.elapsed).toBeCloseTo(0.5)
    expect(pace.expectedPercent).toBeCloseTo(50)
    expect(pace.projectedPercent).toBeCloseTo(40)
    expect(pace.limitAtMs).toBeNull()
    expect(pace.status).toBe('under')
  })

  it('reports when the limit is hit before reset', () => {
    const pace = paceAt(50, resetsAfter(1))
    expect(pace.status).toBe('over')
    expect(pace.projectedPercent).toBeCloseTo(250)
    // 50% per hour: the remaining 50% runs out in one hour.
    expect(pace.limitAtMs).toBe(NOW_MS + HOUR_SECONDS * 1000)
  })

  it('treats usage near even pace as on pace', () => {
    const pace = paceAt(52, resetsAfter(2.5))
    expect(pace.status).toBe('on-pace')
  })

  it('does not project early in the window', () => {
    const pace = paceAt(3, resetsAfter(0.1))
    expect(pace.projectedPercent).toBeNull()
    expect(pace.limitAtMs).toBeNull()
  })

  it('has no limit time once the limit is reached', () => {
    const pace = paceAt(100, resetsAfter(1))
    expect(pace.status).toBe('over')
    expect(pace.limitAtMs).toBeNull()
  })

  it('accepts reset times in milliseconds', () => {
    const pace = paceAt(20, resetsAfter(2.5) * 1000)
    expect(pace.elapsed).toBeCloseTo(0.5)
  })
})
