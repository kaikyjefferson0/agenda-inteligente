import {
  addLocalDays,
  formatMinutes,
  localDateTimeToInstant,
  localMinutes,
  localWeekday,
  parseInstant,
  parseLocalTime,
  startOfLocalDay,
} from '@/lib/datetime'

import type { StaffAppointment, TimeBlock, WorkingInterval } from './queries'

/**
 * The time typed by the team, checked before sending (D82): the past and the
 * working hours (RN19, RN03), the two refusals that do not depend on the
 * agenda of the moment. Conflicts and blocks are left to the API, which
 * decides them under lock (RN14) and says why (`reason`, D77); the free ranges
 * only help to choose.
 */

/** Minutes since local midnight, `[start, end)`. */
export interface Range {
  start: number
  end: number
}

const DAY_MINUTES = 24 * 60

/** The working intervals of the weekday of `localDate`, in order. */
export function workingRangesOf(intervals: WorkingInterval[], localDate: string): Range[] {
  const weekday = localWeekday(localDate)
  return intervals
    .filter((interval) => interval.weekday === weekday)
    .map((interval) => ({
      start: parseLocalTime(interval.start_time.slice(0, 5)) ?? 0,
      end: parseLocalTime(interval.end_time.slice(0, 5)) ?? DAY_MINUTES,
    }))
    .sort((a, b) => a.start - b.start)
}

/** `09:00–12:00 e 13:00–19:00` */
export function formatRanges(ranges: Range[]): string {
  const parts = ranges.map((range) => `${formatMinutes(range.start)}–${formatMinutes(range.end)}`)
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`
}

/** The part of `[from, to)` inside the local day, in minutes of the wall clock. */
function clipToDay(from: string, to: string, localDate: string, timeZone: string): Range | null {
  const dayStart = startOfLocalDay(localDate, timeZone).getTime()
  const dayEnd = startOfLocalDay(addLocalDays(localDate, 1), timeZone).getTime()
  const start = parseInstant(from).getTime()
  const end = parseInstant(to).getTime()
  if (end <= dayStart || start >= dayEnd) return null
  return {
    start: start <= dayStart ? 0 : localMinutes(from, timeZone),
    end: end >= dayEnd ? DAY_MINUTES : localMinutes(to, timeZone),
  }
}

/**
 * The occupied time of the professional on the day: appointments not
 * cancelled, with the preparation (RN03), and blocks (RN04). A reschedule may
 * overlap its own current time (D30), so that appointment is left out.
 */
export function busyRangesOf(
  professionalId: string,
  appointments: StaffAppointment[],
  blocks: TimeBlock[],
  localDate: string,
  timeZone: string,
  exceptId?: string,
): Range[] {
  const ranges: Range[] = []
  for (const appointment of appointments) {
    if (appointment.professional_id !== professionalId) continue
    if (appointment.status === 'cancelled' || appointment.id === exceptId) continue
    const range = clipToDay(appointment.starts_at, appointment.blocked_until, localDate, timeZone)
    if (range !== null) ranges.push(range)
  }
  for (const block of blocks) {
    const range = clipToDay(block.starts_at, block.ends_at, localDate, timeZone)
    if (range !== null) ranges.push(range)
  }
  return ranges.sort((a, b) => a.start - b.start)
}

/**
 * The free ranges where a block of `blockMinutes` fits whole inside one
 * working interval (RN03), from `notBefore` on (now, on today).
 */
export function freeRanges(
  working: Range[],
  busy: Range[],
  blockMinutes: number,
  notBefore: number | null,
): Range[] {
  const free: Range[] = []
  for (const interval of working) {
    let cursor = Math.max(interval.start, notBefore ?? interval.start)
    const push = (end: number) => {
      if (end - cursor >= blockMinutes) free.push({ start: cursor, end })
    }
    for (const range of busy) {
      if (range.end <= cursor) continue
      if (range.start >= interval.end) break
      if (range.start > cursor) push(Math.min(range.start, interval.end))
      cursor = Math.max(cursor, range.end)
    }
    if (cursor < interval.end) push(interval.end)
  }
  return free
}

export type SlotProblem = 'invalid' | 'nonexistent' | 'in_past' | 'outside_working_hours'

export type SlotCheck = { ok: true; instant: Date } | { ok: false; problem: SlotProblem }

/** Whether the local day and time can be sent, as far as the screen knows. */
export function checkSlot({
  localDate,
  time,
  timeZone,
  now,
  working,
  blockMinutes,
}: {
  localDate: string
  time: string
  timeZone: string
  now: Date
  /** `undefined` while the working hours load: only the past is checked. */
  working: Range[] | undefined
  blockMinutes: number
}): SlotCheck {
  const minutes = parseLocalTime(time)
  if (minutes === null) return { ok: false, problem: 'invalid' }
  const local = localDateTimeToInstant(localDate, time, timeZone)
  if (local.kind === 'nonexistent') return { ok: false, problem: 'nonexistent' }
  if (local.instant.getTime() < now.getTime()) return { ok: false, problem: 'in_past' }
  if (
    working !== undefined &&
    !working.some((range) => minutes >= range.start && minutes + blockMinutes <= range.end)
  ) {
    return { ok: false, problem: 'outside_working_hours' }
  }
  return { ok: true, instant: local.instant }
}
