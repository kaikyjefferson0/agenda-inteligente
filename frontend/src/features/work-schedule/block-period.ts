import {
  addLocalDays,
  formatLocalDate,
  formatTime,
  formatTimeRange,
  isLocalDate,
  localDateTimeToInstant,
  parseInstant,
  parseLocalTime,
  startOfLocalDay,
  toLocalDate,
  toUtcInstant,
} from '@/lib/datetime'

import type { TimeBlock } from '@/features/scheduling'

/**
 * The period of a new block (UC09), typed in the clock of the business and
 * sent in UTC (D56, RN06). A whole day goes from the first instant of the
 * start day to the first instant of the day after the end day, which is 23 or
 * 25 hours on the days the clock changes. A typed time repeated when the clock
 * goes back takes its first occurrence; one skipped when it goes forward does
 * not exist and is refused on its field.
 */

export interface BlockInput {
  allDay: boolean
  startDay: string
  startTime: string
  endDay: string
  endTime: string
}

export type BlockField = 'startDay' | 'startTime' | 'endDay' | 'endTime'

export type BlockPeriod =
  | { kind: 'ok'; startsAt: string; endsAt: string }
  | { kind: 'invalid'; problems: Partial<Record<BlockField, string>> }

function instantOf(day: string, time: string, timeZone: string): Date | 'nonexistent' {
  const local = localDateTimeToInstant(day, time, timeZone)
  return local.kind === 'ok' ? local.instant : 'nonexistent'
}

export function blockPeriodOf(input: BlockInput, timeZone: string): BlockPeriod {
  const problems: Partial<Record<BlockField, string>> = {}
  if (!isLocalDate(input.startDay)) problems.startDay = 'Informe o dia de início.'
  if (!isLocalDate(input.endDay)) problems.endDay = 'Informe o dia de fim.'
  if (!input.allDay) {
    if (parseLocalTime(input.startTime) === null) problems.startTime = 'Informe a hora de início.'
    if (parseLocalTime(input.endTime) === null) problems.endTime = 'Informe a hora de fim.'
  }
  if (Object.keys(problems).length > 0) return { kind: 'invalid', problems }

  let start: Date | 'nonexistent'
  let end: Date | 'nonexistent'
  if (input.allDay) {
    start = startOfLocalDay(input.startDay, timeZone)
    end = startOfLocalDay(addLocalDays(input.endDay, 1), timeZone)
  } else {
    start = instantOf(input.startDay, input.startTime, timeZone)
    end = instantOf(input.endDay, input.endTime, timeZone)
  }
  const skipped = (day: string, time: string) =>
    `${time} não existe em ${formatLocalDate(day)}: o relógio pula essa hora na mudança de horário. Escolha outro horário.`
  if (start === 'nonexistent') problems.startTime = skipped(input.startDay, input.startTime)
  if (end === 'nonexistent') problems.endTime = skipped(input.endDay, input.endTime)
  if (start === 'nonexistent' || end === 'nonexistent') return { kind: 'invalid', problems }

  if (end.getTime() <= start.getTime()) {
    if (input.allDay || input.endDay < input.startDay) {
      problems.endDay = 'O fim precisa ser no dia de início ou depois.'
    } else {
      problems.endTime = 'O fim precisa ser depois do início.'
    }
    return { kind: 'invalid', problems }
  }
  return { kind: 'ok', startsAt: toUtcInstant(start), endsAt: toUtcInstant(end) }
}

/** The blocks that share time with `[startsAt, endsAt)` (half-open, as RN04). */
export function overlappingBlocks(blocks: TimeBlock[], startsAt: string, endsAt: string): TimeBlock[] {
  const start = parseInstant(startsAt).getTime()
  const end = parseInstant(endsAt).getTime()
  return blocks.filter(
    (block) => parseInstant(block.starts_at).getTime() < end && parseInstant(block.ends_at).getTime() > start,
  )
}

/** The blocks still to come or under way at `now`, by start. */
export function upcomingBlocks(blocks: TimeBlock[], now: Date): TimeBlock[] {
  return blocks
    .filter((block) => parseInstant(block.ends_at).getTime() > now.getTime())
    .sort((a, b) => parseInstant(a.starts_at).getTime() - parseInstant(b.starts_at).getTime())
}

export interface BlockWhen {
  /** `sábado, 14/11/2026`, or `sábado, 14/11/2026 a segunda-feira, 16/11/2026`. */
  days: string
  /** `09:00–12:00`, `Dia inteiro`, or the times of a block over several days. */
  hours: string
}

/**
 * How a block is read in the list, in the clock of the business: whole local
 * days (from the first instant of a day to the first of another) by the days
 * alone; otherwise with the times.
 */
export function describeBlock(block: Pick<TimeBlock, 'starts_at' | 'ends_at'>, timeZone: string): BlockWhen {
  const startDay = toLocalDate(block.starts_at, timeZone)
  const endDay = toLocalDate(block.ends_at, timeZone)
  const start = parseInstant(block.starts_at).getTime()
  const end = parseInstant(block.ends_at).getTime()
  const wholeDays =
    start === startOfLocalDay(startDay, timeZone).getTime() && end === startOfLocalDay(endDay, timeZone).getTime()
  if (wholeDays) {
    const lastDay = addLocalDays(endDay, -1)
    return {
      days: lastDay === startDay ? formatLocalDate(startDay) : `${formatLocalDate(startDay)} a ${formatLocalDate(lastDay)}`,
      hours: lastDay === startDay ? 'Dia inteiro' : 'Dias inteiros',
    }
  }
  if (startDay === endDay) {
    return { days: formatLocalDate(startDay), hours: formatTimeRange(block.starts_at, block.ends_at, timeZone) }
  }
  return {
    days: `${formatLocalDate(startDay)} a ${formatLocalDate(endDay)}`,
    hours: `${formatTime(block.starts_at, timeZone)} do primeiro dia às ${formatTime(block.ends_at, timeZone)} do último`,
  }
}
