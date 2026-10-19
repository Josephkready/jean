import { describe, expect, it } from 'vitest'
import type { AgentSchedule } from '@/services/agents'
import {
  cronMinutes,
  emptyScheduleForm,
  formatDateTimeInZone,
  formatInterval,
  formatScheduleWhen,
  formFromSchedule,
  scheduleInputFromForm,
  scheduleKindLabel,
  scheduleUpdateFromForm,
  timezoneOptions,
  validateCronExpression,
  validateScheduleForm,
} from './schedule-form'

function schedule(overrides: Partial<AgentSchedule>): AgentSchedule {
  return {
    id: 1,
    agentId: 'jean',
    name: 'Brief',
    prompt: 'Summarize',
    everySecs: null,
    nextRunAt: 1_700_000_000,
    lastRunAt: null,
    cron: null,
    timezone: null,
    event: null,
    paused: false,
    ...overrides,
  }
}

describe('formatInterval', () => {
  it('uses the largest whole unit', () => {
    expect(formatInterval(30 * 60)).toBe('every 30m')
    expect(formatInterval(2 * 3600)).toBe('every 2h')
    expect(formatInterval(86_400)).toBe('every 1d')
    expect(formatInterval(90 * 60)).toBe('every 90m')
  })
})

describe('validateCronExpression', () => {
  it('accepts five-field expressions at least five minutes apart', () => {
    expect(validateCronExpression('0 9 * * 1-5')).toBeNull()
    expect(validateCronExpression('*/5 * * * *')).toBeNull()
    expect(validateCronExpression('0,5,10 * * * *')).toBeNull()
    expect(cronMinutes('*/15')).toEqual([0, 15, 30, 45])
    expect(cronMinutes('0/15')).toEqual([0, 15, 30, 45])
    expect(cronMinutes('50/5')).toEqual([50, 55])
  })

  it('rejects malformed fields and tight spacing', () => {
    expect(validateCronExpression('* * *')).toMatch(/5 fields/)
    expect(validateCronExpression('* * * * *')).toMatch(/5 minutes/)
    expect(validateCronExpression('*/4 * * * *')).toMatch(/5 minutes/)
    expect(validateCronExpression('58,1 * * * *')).toMatch(/5 minutes/)
    expect(validateCronExpression('60 * * * *')).toMatch(/Minute field/)
  })
})

describe('validateScheduleForm', () => {
  it('checks each kind', () => {
    const cron = {
      ...emptyScheduleForm('UTC'),
      name: 'Standup',
      prompt: 'Summarize overnight changes',
    }
    expect(validateScheduleForm(cron)).toBeNull()
    expect(validateScheduleForm({ ...cron, cron: '*/1 * * * *' })).toMatch(
      /5 minutes/
    )
    expect(
      validateScheduleForm({
        ...cron,
        kind: 'interval',
        everyAmount: '4',
        everyUnit: 'minutes',
      })
    ).toMatch(/5 minutes/)
    expect(validateScheduleForm({ ...cron, kind: 'once', runAt: '' })).toMatch(
      /date and time/
    )
    expect(
      validateScheduleForm({ ...cron, kind: 'once', runAt: '2026-11-03 9:00' })
    ).toMatch(/date and time/)
    expect(
      validateScheduleForm({ ...cron, kind: 'once', runAt: '2026-11-03T09:00' })
    ).toBeNull()
    expect(validateScheduleForm({ ...cron, kind: 'event' })).toBeNull()
    expect(validateScheduleForm({ ...cron, name: '  ' })).toMatch(/Name/)
  })
})

describe('formatScheduleWhen', () => {
  const now = 1_700_000_000_000

  it('describes cron, events, intervals, and one-shots', () => {
    expect(
      formatScheduleWhen(
        schedule({
          cron: '0 9 * * 1-5',
          timezone: 'UTC',
          nextRunAt: now / 1000 + 3600,
        }),
        now
      )
    ).toBe('0 9 * * 1-5 UTC, next in 1h')
    expect(
      formatScheduleWhen(
        schedule({ event: 'pr_merged', lastRunAt: now / 1000 - 120 }),
        now
      )
    ).toBe('on Pull request merged, last 2m ago')
    expect(
      formatScheduleWhen(
        schedule({ everySecs: 3600, nextRunAt: now / 1000 + 60 }),
        now
      )
    ).toBe('every 1h, next in 1m')
    expect(
      formatScheduleWhen(schedule({ nextRunAt: now / 1000 + 15 * 86_400 }), now)
    ).toMatch(/^once .*\d.*, in 15d$/)
    expect(formatScheduleWhen(schedule({ paused: true }), now)).toBe(
      'once, paused'
    )
  })
})

describe('formatDateTimeInZone', () => {
  const instant = Date.UTC(2026, 10, 3, 8, 30) / 1000

  it('prints wall-clock time in the given zone', () => {
    expect(formatDateTimeInZone(instant, 'UTC')).toBe('2026-11-03T08:30')
    expect(formatDateTimeInZone(instant, 'Europe/Budapest')).toBe(
      '2026-11-03T09:30'
    )
    expect(
      formatDateTimeInZone(
        Date.UTC(2026, 6, 1, 22, 5) / 1000,
        'Europe/Budapest'
      )
    ).toBe('2026-07-02T00:05')
  })

  it('defaults a new form to tomorrow 09:00 in its zone', () => {
    // 23:30 UTC on Nov 3 is already Nov 4 in Budapest.
    const now = Date.UTC(2026, 10, 3, 23, 30)
    expect(emptyScheduleForm('UTC', now).runAt).toBe('2026-11-04T09:00')
    expect(emptyScheduleForm('Europe/Budapest', now).runAt).toBe(
      '2026-11-05T09:00'
    )
  })
})

describe('schedule input', () => {
  it('sends a one-shot as wall-clock time plus zone', () => {
    expect(
      scheduleInputFromForm({
        ...emptyScheduleForm('UTC'),
        name: 'Release',
        prompt: 'Cut the release',
        kind: 'once',
        runAt: '2026-11-03T09:00',
        timezone: 'Europe/Budapest',
      })
    ).toEqual({
      name: 'Release',
      prompt: 'Cut the release',
      kind: 'once',
      paused: false,
      runAt: '2026-11-03T09:00',
      timezone: 'Europe/Budapest',
    })
  })

  it('keeps the browser timezone in the list and maps a form to command fields', () => {
    expect(timezoneOptions('Europe/Helsinki')[0]).toBe('Europe/Helsinki')
    expect(timezoneOptions('UTC')).toContain('UTC')
    const input = scheduleInputFromForm({
      ...emptyScheduleForm('UTC'),
      name: ' Standup ',
      prompt: ' Say hello ',
      kind: 'interval',
      everyAmount: '2',
      everyUnit: 'hours',
    })
    expect(input).toMatchObject({
      name: 'Standup',
      prompt: 'Say hello',
      kind: 'interval',
      everySecs: 7200,
    })
    const stored = formFromSchedule(
      schedule({
        everySecs: 7200,
        cron: null,
        name: 'Standup',
        prompt: 'Say hello',
      })
    )
    expect(stored.kind).toBe('interval')
    expect(stored.everyAmount).toBe('2')
    expect(stored.everyUnit).toBe('hours')
  })
})

describe('scheduleUpdateFromForm', () => {
  it('omits timing when only the name changes, so the routine keeps its time', () => {
    const once = schedule({
      name: 'Brief',
      prompt: 'Summarize',
      nextRunAt: Date.UTC(2026, 10, 3, 8, 30) / 1000,
    })
    const form = formFromSchedule(once)
    expect(formatDateTimeInZone(once.nextRunAt, form.timezone)).toBe(form.runAt)
    const renamed = { ...form, name: 'Morning brief' }
    expect(scheduleUpdateFromForm(renamed, once)).toEqual({
      name: 'Morning brief',
      prompt: 'Summarize',
      paused: false,
    })
  })

  it('sends the new run time when a one-shot moved', () => {
    const once = schedule({ nextRunAt: Date.UTC(2026, 10, 3, 8, 30) / 1000 })
    const moved = {
      ...formFromSchedule(once),
      runAt: '2026-12-01T10:00',
      timezone: 'UTC',
    }
    expect(scheduleUpdateFromForm(moved, once)).toEqual({
      name: 'Brief',
      prompt: 'Summarize',
      paused: false,
      kind: 'once',
      everySecs: undefined,
      runAt: '2026-12-01T10:00',
      cron: undefined,
      timezone: 'UTC',
      event: undefined,
    })
  })

  it('sends the new timing when it changed', () => {
    const cron = schedule({ cron: '0 9 * * 1-5', timezone: 'UTC' })
    const moved = { ...formFromSchedule(cron), cron: '0 10 * * 1-5' }
    expect(scheduleUpdateFromForm(moved, cron)).toEqual({
      name: 'Brief',
      prompt: 'Summarize',
      paused: false,
      kind: 'cron',
      everySecs: undefined,
      runAt: undefined,
      cron: '0 10 * * 1-5',
      timezone: 'UTC',
      event: undefined,
    })
  })
})

describe('scheduleKindLabel', () => {
  it('names the trigger type', () => {
    expect(scheduleKindLabel(schedule({ event: 'pr_merged' }))).toBe('Event')
    expect(scheduleKindLabel(schedule({ cron: '0 9 * * 1-5' }))).toBe('Cron')
    expect(scheduleKindLabel(schedule({ everySecs: 3600 }))).toBe('Interval')
    expect(
      scheduleKindLabel(schedule({ everySecs: null, cron: null, event: null }))
    ).toBe('Once')
  })
})
