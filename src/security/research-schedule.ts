/** Pure time-window selection for the research scheduler; independent from DSH and safe to unit test with a clock. */
import type { ResearchConfig, ResearchSchedule } from '../policy.ts'

const minutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
export interface ResearchWindow {
  schedule: ResearchSchedule
  localTime: string
  nextTransitionAt: string
}
function localParts(now: Date, timezone: string): { day: string; minute: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const year = date.find(part => part.type === 'year')?.value ?? '0000'
  const month = date.find(part => part.type === 'month')?.value ?? '01'
  const day = date.find(part => part.type === 'day')?.value ?? '01'
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0)
  return { day: `${year}-${month}-${day}`, minute: hour * 60 + minute, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
}

/** Convert a wall-clock date/time in an IANA timezone to an instant without a timezone database dependency. */
function zonedDate(day: string, time: string, timezone: string): Date {
  const wanted = Date.parse(`${day}T${time}:00Z`)
  let guess = wanted
  // Correct the UTC guess using the wall-clock value reported by Intl. Two passes cover
  // ordinary offsets and the one-hour DST transitions used by IANA zones. The result is
  // an operator-facing estimate; the scheduler itself still evaluates the window each pass.
  for (let attempt = 0; attempt < 3; attempt++) {
    const actual = localParts(new Date(guess), timezone)
    const observed = Date.parse(`${actual.day}T${actual.time}:00Z`)
    const corrected = guess + (wanted - observed)
    if (corrected === guess) break
    guess = corrected
  }
  return new Date(guess)
}

function followingDay(day: string): string {
  const next = new Date(`${day}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}
export function activeResearchSchedule(config: ResearchConfig, now = new Date()): ResearchWindow | undefined {
  const selected = config.schedules.find(item => {
    const local = localParts(now, item.timezone)
    const start = minutes(item.start), end = minutes(item.end)
    return start === end ? true : start < end ? local.minute >= start && local.minute < end : local.minute >= start || local.minute < end
  })
  if (!selected) return undefined
  const local = localParts(now, selected.timezone)
  // This is deliberately an operator-facing estimate; scheduling itself is evaluated on every host pass.
  // The active window always ends at its configured end time. For an overnight window,
  // the end belongs to the following local day when the current time is after the start.
  const endDay = selected.start === selected.end
    ? followingDay(local.day)
    : selected.start < selected.end || local.minute < minutes(selected.start) ? local.day : followingDay(local.day)
  const nextTransitionAt = zonedDate(endDay, selected.end, selected.timezone).toISOString()
  return { schedule: selected, localTime: local.time, nextTransitionAt }
}
