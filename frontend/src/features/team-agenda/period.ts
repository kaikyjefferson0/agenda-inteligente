import {
  addLocalDays,
  localDateRange,
  localWeekday,
  startOfLocalDay,
  toUtcInstant,
} from '@/lib/datetime'

/**
 * The period of the agenda (D78): one request per week of the business, from
 * Monday to the next Monday, in local days. The day and the week views read
 * the same request, so moving inside a week or changing view never fetches.
 * A week has 168 hours (167 or 169 across a change of offset), far below the
 * 31 × 24 hours of `GET /appointments`.
 */

/** The Monday of the week of `localDate` (the weekday 0 of the API). */
export function weekStartOf(localDate: string): string {
  return addLocalDays(localDate, -localWeekday(localDate))
}

/** The seven local days of the week that starts on `weekStart`. */
export function weekDays(weekStart: string): string[] {
  return localDateRange(weekStart, 7)
}

export interface Period {
  /** UTC instants of `[from, to)`, as the API expects (D25). */
  from: string
  to: string
}

/** From the first instant of Monday to the first instant of the next Monday. */
export function weekPeriod(weekStart: string, timeZone: string): Period {
  return {
    from: toUtcInstant(startOfLocalDay(weekStart, timeZone)),
    to: toUtcInstant(startOfLocalDay(addLocalDays(weekStart, 7), timeZone)),
  }
}
