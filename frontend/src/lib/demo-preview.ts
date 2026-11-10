import { formatLocalDate, type Instant, toLocalDate } from './datetime'

/** Time zone of the demo business (D43). */
export const DEMO_TIME_ZONE = 'America/Sao_Paulo'

/** The demo works from Tuesday to Saturday (D43); `getUTCDay` numbering. */
const DEMO_OPEN_WEEKDAYS = new Set([2, 3, 4, 5, 6])

/**
 * First working day of the demo from `now` on, in its time zone, as
 * `YYYY-MM-DD`. The preview of the home page shows it instead of a fixed date.
 */
export function nextDemoDay(now: Instant): string {
  const [year, month, day] = toLocalDate(now, DEMO_TIME_ZONE).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  while (!DEMO_OPEN_WEEKDAYS.has(date.getUTCDay())) {
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return date.toISOString().slice(0, 10)
}

/** `terça-feira, 10/11`: the label of the preview, without the year. */
export function formatDemoDay(localDate: string): string {
  return formatLocalDate(localDate).replace(/\/\d{4}$/, '')
}
