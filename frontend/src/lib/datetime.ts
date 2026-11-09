/**
 * Dates and time zones (D56).
 *
 * Every function receives the time zone of the business and formats with
 * `Intl.DateTimeFormat('pt-BR', { timeZone })`. None of them uses the time zone
 * of the browser: a visitor in Tokyo sees the hours of a business in São Paulo
 * as the business sees them.
 *
 * Instants come from the API as ISO 8601 strings with an offset: the public
 * routes use the offset of the business (`2026-11-10T09:00:00-03:00`) and the
 * administration routes use UTC (`2026-11-10T12:00:00Z`). Both are accepted;
 * a string without an offset is refused, because `Date` would read it in the
 * time zone of the browser.
 */

export type Instant = string | Date

const LOCALE = 'pt-BR'
const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`
  let cached = formatters.get(key)
  if (cached === undefined) {
    cached = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone })
    formatters.set(key, cached)
  }
  return cached
}

const DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'long' }
const PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}

/** Reads an instant from the API. Throws when the string has no offset. */
export function parseInstant(value: Instant): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError('Invalid date')
    return value
  }
  if (!OFFSET_ISO.test(value)) {
    throw new RangeError(`Instant without offset: ${value}`)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid instant: ${value}`)
  return date
}

/** `10/11/2026` */
export function formatDate(instant: Instant, timeZone: string): string {
  return formatter(timeZone, DATE).format(parseInstant(instant))
}

/** `09:00` */
export function formatTime(instant: Instant, timeZone: string): string {
  return formatter(timeZone, TIME).format(parseInstant(instant))
}

/** `terça-feira` */
export function formatWeekday(instant: Instant, timeZone: string): string {
  return formatter(timeZone, WEEKDAY).format(parseInstant(instant))
}

/** `terça-feira, 10/11/2026 às 09:00`, as in the e-mails (D37). */
export function formatDateTime(instant: Instant, timeZone: string): string {
  return `${formatWeekday(instant, timeZone)}, ${formatDate(instant, timeZone)} às ${formatTime(instant, timeZone)}`
}

/**
 * `09:00–09:30` on the same local day, or `10/11/2026 23:30 – 11/11/2026 00:30`
 * when the interval crosses midnight in the business.
 */
export function formatTimeRange(start: Instant, end: Instant, timeZone: string): string {
  const startDay = toLocalDate(start, timeZone)
  const endDay = toLocalDate(end, timeZone)
  if (startDay === endDay) {
    return `${formatTime(start, timeZone)}–${formatTime(end, timeZone)}`
  }
  return `${formatDate(start, timeZone)} ${formatTime(start, timeZone)} – ${formatDate(end, timeZone)} ${formatTime(end, timeZone)}`
}

/** The local day of the instant in the business, as `YYYY-MM-DD`. */
export function toLocalDate(instant: Instant, timeZone: string): string {
  const parts = formatter(timeZone, PARTS).formatToParts(parseInstant(instant))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * A local day of the business without time, such as `date` in the
 * availability (`2026-11-10`), as `terça-feira, 10/11/2026`. It is a calendar
 * day, so it is formatted in UTC and never shifts with any time zone.
 */
export function formatLocalDate(localDate: string): string {
  const match = LOCAL_DATE.exec(localDate)
  if (match === null) throw new RangeError(`Invalid local date: ${localDate}`)
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (date.getUTCDate() !== Number(day)) throw new RangeError(`Invalid local date: ${localDate}`)
  return `${formatter('UTC', WEEKDAY).format(date)}, ${formatter('UTC', DATE).format(date)}`
}
