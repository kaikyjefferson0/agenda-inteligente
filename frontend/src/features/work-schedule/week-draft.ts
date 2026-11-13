import { formatMinutes, parseLocalTime } from '@/lib/datetime'

import type { WorkingInterval } from '@/features/scheduling'

/**
 * The week being edited (UC08): seven days, from Monday (`weekday` 0, as in
 * the API) to Sunday, each with zero or more intervals in local time (RN06).
 * A lunch break is two intervals on the same day. The `PUT` replaces the whole
 * week, so the draft is always sent entire.
 */

export interface DraftInterval {
  /** Stable while editing, for React and for the ids of the fields. */
  key: string
  /** `HH:MM`, or `''` while the field is empty. */
  start: string
  end: string
}

export type WeekDraft = DraftInterval[][]

export const WEEKDAYS = [
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
  'Domingo',
] as const

/** The names of the days where space is short, such as the targets of a copy. */
export const SHORT_WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'] as const

let nextKey = 0
const newKey = () => `intervalo-${++nextKey}`

/** The API answers `09:00`; `09:00:00` would also be a valid time. */
const hhmm = (time: string) => time.slice(0, 5)

export function draftOf(intervals: WorkingInterval[]): WeekDraft {
  const week: WeekDraft = WEEKDAYS.map(() => [])
  for (const interval of [...intervals].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    week[interval.weekday]?.push({ key: newKey(), start: hhmm(interval.start_time), end: hhmm(interval.end_time) })
  }
  return week
}

/** The body of the `PUT`, in the order of the week and of the day. Only for a valid draft. */
export function intervalsOf(week: WeekDraft): WorkingInterval[] {
  return week.flatMap((day, weekday) =>
    [...day]
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((interval) => ({ weekday, start_time: interval.start, end_time: interval.end })),
  )
}

/** Whether two drafts send the same week, whatever the order of the fields. */
export function sameWeek(a: WeekDraft, b: WeekDraft): boolean {
  return JSON.stringify(intervalsOf(a)) === JSON.stringify(intervalsOf(b))
}

/**
 * A new interval at the end of the day: after the last one, for an hour
 * (the afternoon after the lunch), or 09:00–18:00 on a closed day.
 */
export function addInterval(week: WeekDraft, weekday: number): WeekDraft {
  const day = week[weekday]
  const lastEnd = day.map((interval) => parseLocalTime(interval.end)).filter((value) => value !== null)
  const after = lastEnd.length > 0 ? Math.max(...lastEnd) : null
  let start = 9 * 60
  let end = 18 * 60
  if (after !== null) {
    start = Math.min(after + 60, 23 * 60)
    end = Math.min(start + 4 * 60, 23 * 60 + 59)
  }
  const added = { key: newKey(), start: formatMinutes(start), end: formatMinutes(end) }
  return week.map((items, index) => (index === weekday ? [...items, added] : items))
}

export function removeInterval(week: WeekDraft, weekday: number, key: string): WeekDraft {
  return week.map((items, index) => (index === weekday ? items.filter((item) => item.key !== key) : items))
}

export function changeInterval(
  week: WeekDraft,
  weekday: number,
  key: string,
  change: Partial<Pick<DraftInterval, 'start' | 'end'>>,
): WeekDraft {
  return week.map((items, index) =>
    index === weekday ? items.map((item) => (item.key === key ? { ...item, ...change } : item)) : items,
  )
}

/** The intervals of `from` replace those of each target day, closed or not. */
export function copyDay(week: WeekDraft, from: number, targets: number[]): WeekDraft {
  return week.map((items, index) =>
    index !== from && targets.includes(index)
      ? week[from].map((interval) => ({ ...interval, key: newKey() }))
      : items,
  )
}

export interface IntervalProblem {
  weekday: number
  key: string
  field: 'start' | 'end'
  message: string
}

/**
 * What the API would refuse with `422` (UC08), told before sending, on the
 * field to fix: an empty time, an end not after the start, and two intervals
 * of the same day that overlap. Touching intervals (12:00–12:00) are accepted,
 * as in the API, which treats them as half-open (RN04).
 */
export function problemsOf(week: WeekDraft): IntervalProblem[] {
  const problems: IntervalProblem[] = []
  week.forEach((day, weekday) => {
    const valid: { key: string; start: number; end: number }[] = []
    for (const interval of day) {
      const start = parseLocalTime(interval.start)
      const end = parseLocalTime(interval.end)
      const at = (field: 'start' | 'end', message: string) =>
        problems.push({ weekday, key: interval.key, field, message })
      if (start === null) at('start', 'Informe a hora de início.')
      if (end === null) at('end', 'Informe a hora de fim.')
      if (start === null || end === null) continue
      if (end <= start) {
        at('end', `O fim precisa ser depois do início (${interval.start}).`)
        continue
      }
      valid.push({ key: interval.key, start, end })
    }
    valid.sort((a, b) => a.start - b.start)
    for (let index = 1; index < valid.length; index += 1) {
      const previous = valid[index - 1]
      const current = valid[index]
      if (current.start < previous.end) {
        problems.push({
          weekday,
          key: current.key,
          field: 'start',
          message: `Sobrepõe o intervalo ${formatMinutes(previous.start)}–${formatMinutes(previous.end)}. Comece às ${formatMinutes(previous.end)} ou depois.`,
        })
      }
    }
  })
  return problems
}

/** `09:00–12:00 e 13:00–19:00`, or `Fechado`. */
export function daySummary(day: DraftInterval[]): string {
  const parts = [...day]
    .filter((interval) => interval.start !== '' && interval.end !== '')
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((interval) => `${interval.start}–${interval.end}`)
  if (day.length === 0) return 'Fechado'
  if (parts.length === 0) return 'Horário incompleto'
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`
}

/** The id of a time field, for the focus from the summary of problems. */
export const fieldId = (key: string, field: 'start' | 'end') => `${key}-${field === 'start' ? 'inicio' : 'fim'}`
