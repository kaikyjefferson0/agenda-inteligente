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
  const date = parseLocalDate(localDate)
  if (date === null) throw new RangeError(`Invalid local date: ${localDate}`)
  return `${formatter('UTC', WEEKDAY).format(date)}, ${formatter('UTC', DATE).format(date)}`
}

function parseLocalDate(localDate: string): Date | null {
  const match = LOCAL_DATE.exec(localDate)
  if (match === null) return null
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  // Date.UTC rolls over (month 13, day 31 of April): the parts must come back as given.
  return date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? date : null
}

/** Whether the string is a real calendar day as `YYYY-MM-DD` (e.g. not `2026-02-30`). */
export function isLocalDate(value: string): boolean {
  return parseLocalDate(value) !== null
}

/** The calendar day `days` after `localDate`, as `YYYY-MM-DD`. Pure date math, no time zone. */
export function addLocalDays(localDate: string, days: number): string {
  const date = parseLocalDate(localDate)
  if (date === null) throw new RangeError(`Invalid local date: ${localDate}`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** `count` consecutive calendar days from `first`, inclusive. */
export function localDateRange(first: string, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => addLocalDays(first, index))
}

export interface LocalDayParts {
  /** `ter`, without the abbreviation dot. */
  weekday: string
  /** `12` */
  day: string
  /** `nov`, without the abbreviation dot. */
  month: string
}

const SHORT_WEEKDAY: Intl.DateTimeFormatOptions = { weekday: 'short' }
const SHORT_MONTH: Intl.DateTimeFormatOptions = { month: 'short' }

/** The pieces of a calendar day for a compact day picker. */
export function formatLocalDayParts(localDate: string): LocalDayParts {
  const date = parseLocalDate(localDate)
  if (date === null) throw new RangeError(`Invalid local date: ${localDate}`)
  const strip = (text: string) => text.replace('.', '')
  return {
    weekday: strip(formatter('UTC', SHORT_WEEKDAY).format(date)),
    day: String(date.getUTCDate()),
    month: strip(formatter('UTC', SHORT_MONTH).format(date)),
  }
}

/** The hour (0 to 23) of the instant in the business. */
export function localHour(instant: Instant, timeZone: string): number {
  return Number(formatTime(instant, timeZone).slice(0, 2))
}

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** The wall clock of the instant in the business, read as if it were UTC (ms). */
function wallClockMs(instant: number, timeZone: string): number {
  const parts = formatter(timeZone, PARTS).formatToParts(new Date(instant))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
}

/** Minutes since the local midnight of the wall clock (0 to 1439). */
export function localMinutes(instant: Instant, timeZone: string): number {
  const time = formatTime(instant, timeZone)
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

/** `HH:MM` as minutes since midnight, or `null` when it is not a time of the day. */
export function parseLocalTime(time: string): number | null {
  const match = LOCAL_TIME.exec(time)
  return match === null ? null : Number(match[1]) * 60 + Number(match[2])
}

/** Minutes since midnight as `HH:MM`. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** 0 for Monday to 6 for Sunday, as `weekday` in the API (docs/07-api.md). */
export function localWeekday(localDate: string): number {
  const date = parseLocalDate(localDate)
  if (date === null) throw new RangeError(`Invalid local date: ${localDate}`)
  return (date.getUTCDay() + 6) % 7
}

export type LocalInstant =
  | { kind: 'ok'; instant: Date }
  /** The local time was skipped by a change of offset, such as the start of daylight time. */
  | { kind: 'nonexistent' }

/**
 * The instant of a local day and time of the business (RN06): an ambiguous
 * time, repeated when the clock goes back, takes its first occurrence; a time
 * skipped when the clock goes forward does not exist.
 */
export function localDateTimeToInstant(localDate: string, time: string, timeZone: string): LocalInstant {
  const date = parseLocalDate(localDate)
  const minutes = parseLocalTime(time)
  if (date === null || minutes === null) throw new RangeError(`Invalid local time: ${localDate} ${time}`)
  const wanted = date.getTime() + minutes * MINUTE_MS
  // The offsets around the wanted wall clock: any instant that shows it uses one of them.
  const offsets = new Set(
    [wanted - DAY_MS, wanted, wanted + DAY_MS].map((probe) => wallClockMs(probe, timeZone) - probe),
  )
  const matches = [...offsets]
    .map((offset) => wanted - offset)
    .filter((instant) => wallClockMs(instant, timeZone) === wanted)
    .sort((a, b) => a - b)
  return matches.length === 0 ? { kind: 'nonexistent' } : { kind: 'ok', instant: new Date(matches[0]) }
}

/**
 * The first instant of a local day of the business. It is not always 00:00:
 * on 04/11/2018 in São Paulo the clock went from 23:59 straight to 01:00.
 */
export function startOfLocalDay(localDate: string, timeZone: string): Date {
  const midnight = localDateTimeToInstant(localDate, '00:00', timeZone)
  if (midnight.kind === 'ok') return midnight.instant
  // Midnight was skipped: the day starts at the change, with the offset of the day before.
  const wall = parseLocalDate(localDate)!.getTime()
  const before = wall - DAY_MS
  return new Date(wall - (wallClockMs(before, timeZone) - before))
}

/** An instant for the API, in UTC and without fractions: `2026-11-10T12:07:00Z`. */
export function toUtcInstant(instant: Instant): string {
  return parseInstant(instant).toISOString().replace(/\.\d{3}Z$/, 'Z')
}
