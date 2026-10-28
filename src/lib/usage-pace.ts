import { toEpochMs } from '@/lib/usage-format'

export const HOUR_SECONDS = 3600
export const WEEK_SECONDS = 7 * 24 * HOUR_SECONDS

/** Below this share of the window, the burn rate is too noisy to project. */
const MIN_PROJECTION_ELAPSED = 0.05
/** Usage within this many points of even pace counts as on pace. */
const ON_PACE_TOLERANCE = 5

export type UsagePaceStatus = 'under' | 'on-pace' | 'over'

export interface UsagePace {
  startMs: number
  endMs: number
  /** Share of the window that has passed, 0..1. */
  elapsed: number
  /** Usage at an even burn rate for the elapsed time, 0..100. */
  expectedPercent: number
  /** Usage at reset if the average rate so far continues; null too early. */
  projectedPercent: number | null
  /** When the limit is hit at the average rate, if before reset. */
  limitAtMs: number | null
  status: UsagePaceStatus
}

/**
 * Compare usage with an even burn rate across the window. Backends report
 * only the current percent and the reset time, so the projection uses the
 * average rate since the window started.
 */
export function computeUsagePace(
  usedPercent: number,
  resetsAt: number | null,
  windowSeconds: number | null | undefined,
  nowMs: number
): UsagePace | null {
  if (!resetsAt || !windowSeconds || windowSeconds <= 0) return null
  const endMs = toEpochMs(resetsAt)
  const windowMs = windowSeconds * 1000
  const startMs = endMs - windowMs
  if (nowMs >= endMs) return null

  const used = Math.max(0, Math.min(100, usedPercent))
  const elapsed = Math.max(0, Math.min(1, (nowMs - startMs) / windowMs))
  const expectedPercent = elapsed * 100
  const canProject = elapsed >= MIN_PROJECTION_ELAPSED
  const projectedPercent = canProject ? used / elapsed : null

  let limitAtMs: number | null = null
  if (projectedPercent !== null && projectedPercent > 100 && used < 100) {
    const ratePerMs = used / (nowMs - startMs)
    limitAtMs = nowMs + (100 - used) / ratePerMs
  }

  let status: UsagePaceStatus = 'on-pace'
  if (used >= 100 || used > expectedPercent + ON_PACE_TOLERANCE) {
    status = 'over'
  } else if (used < expectedPercent - ON_PACE_TOLERANCE) {
    status = 'under'
  }

  return {
    startMs,
    endMs,
    elapsed,
    expectedPercent,
    projectedPercent,
    limitAtMs,
    status,
  }
}
