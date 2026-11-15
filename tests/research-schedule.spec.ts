import { describe, expect, it } from 'vitest'
import { ResearchConfigSchema } from '../src/policy.ts'
import { activeResearchSchedule } from '../src/security/research-schedule.ts'

const config = ResearchConfigSchema.parse({ schedules: [
  { id: 'day-window', name: 'Day', timezone: 'Asia/Shanghai', start: '06:30', end: '00:30', maxWorkers: 1, model: { provider: 'p', model: 'day' } },
  { id: 'night-window', name: 'Night', timezone: 'Asia/Shanghai', start: '00:30', end: '06:30', maxWorkers: 3, model: { provider: 'p', model: 'night' } },
] })

describe('research schedule', () => {
  it('selects the configured profile and capacity at local boundaries', () => {
    expect(activeResearchSchedule(config, new Date('2026-11-14T17:29:00Z'))?.schedule.model?.model).toBe('night')
    expect(activeResearchSchedule(config, new Date('2026-11-14T22:30:00Z'))?.schedule.model?.model).toBe('day')
    expect(activeResearchSchedule(config, new Date('2026-11-14T16:29:00Z'))?.schedule.maxWorkers).toBe(1)
  })
  it('returns no window when an operator leaves a gap', () => {
    const value = ResearchConfigSchema.parse({ schedules: [
      { id: 'short', name: 'Short', timezone: 'Asia/Shanghai', start: '10:00', end: '11:00', maxWorkers: 1, model: { provider: 'p', model: 'day' } },
    ] })
    expect(activeResearchSchedule(value, new Date('2026-11-14T04:00:00Z'))).toBeUndefined()
  })
  it('reports the next boundary in the configured timezone for overnight windows', () => {
    const value = ResearchConfigSchema.parse({ schedules: [
      { id: 'overnight', name: 'Overnight', timezone: 'Asia/Shanghai', start: '22:00', end: '06:00', maxWorkers: 1, model: null },
    ] })
    const window = activeResearchSchedule(value, new Date('2026-11-14T16:00:00Z'))
    expect(window?.localTime).toBe('00:00')
    expect(window?.nextTransitionAt).toBe('2026-11-14T22:00:00.000Z')
  })
  it('does not expose a past transition for an all-day window', () => {
    const value = ResearchConfigSchema.parse({ schedules: [
      { id: 'all-day', name: 'All day', timezone: 'UTC', start: '00:00', end: '00:00', maxWorkers: 1, model: null },
    ] })
    expect(activeResearchSchedule(value, new Date('2026-11-14T12:00:00Z'))?.nextTransitionAt).toBe('2026-11-15T00:00:00.000Z')
  })
  it('migrates the former config-level timezone onto schedules', () => {
    const value = ResearchConfigSchema.parse({ timezone: 'UTC', schedules: [
      { id: 'utc', name: 'UTC', start: '10:00', end: '11:00', maxWorkers: 1, model: null },
    ] })
    expect(value.schedules[0]!.timezone).toBe('UTC')
  })
  it('rejects overlapping windows in the same timezone instead of relying on row order', () => {
    expect(() => ResearchConfigSchema.parse({ schedules: [
      { id: 'first', name: 'First', timezone: 'Asia/Shanghai', start: '00:30', end: '04:00', maxWorkers: 1, model: null },
      { id: 'second', name: 'Second', timezone: 'Asia/Shanghai', start: '03:00', end: '06:00', maxWorkers: 2, model: null },
    ] })).toThrow(/Overlapping schedules/)
  })
})
