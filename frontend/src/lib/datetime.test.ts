import { describe, expect, it } from 'vitest'

import {
  formatDate,
  formatDateTime,
  formatLocalDate,
  formatTime,
  formatTimeRange,
  formatWeekday,
  parseInstant,
  toLocalDate,
} from './datetime'

const SAO_PAULO = 'America/Sao_Paulo'

describe('test environment', () => {
  it('runs in Asia/Tokyo, far from the businesses (D56)', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Tokyo')
    expect(new Date('2026-11-10T12:00:00Z').getTimezoneOffset()).toBe(-540)
  })
})

describe('formats in the time zone of the business', () => {
  // 12:00 UTC is 21:00 of the same day in Tokyo, and 09:00 in São Paulo.
  const utc = '2026-11-10T12:00:00Z'
  const withOffset = '2026-11-10T09:00:00-03:00'

  it.each([utc, withOffset])('formats %s as the business sees it', (instant) => {
    expect(formatDate(instant, SAO_PAULO)).toBe('10/11/2026')
    expect(formatTime(instant, SAO_PAULO)).toBe('09:00')
    expect(formatWeekday(instant, SAO_PAULO)).toBe('terça-feira')
    expect(formatDateTime(instant, SAO_PAULO)).toBe('terça-feira, 10/11/2026 às 09:00')
    expect(toLocalDate(instant, SAO_PAULO)).toBe('2026-11-10')
  })

  it('never uses the time zone of the browser', () => {
    // 23:30 in São Paulo is already the next day in Tokyo.
    const instant = '2026-11-11T02:30:00Z'
    expect(formatDate(instant, SAO_PAULO)).toBe('10/11/2026')
    expect(formatTime(instant, SAO_PAULO)).toBe('23:30')
    expect(formatDate(instant, 'Asia/Tokyo')).toBe('11/11/2026')
  })

  it('uses 24 hours, with midnight as 00:00', () => {
    expect(formatTime('2026-11-10T03:00:00Z', SAO_PAULO)).toBe('00:00')
  })

  it('accepts a Date', () => {
    expect(formatTime(new Date('2026-11-10T12:00:00Z'), SAO_PAULO)).toBe('09:00')
  })
})

describe('daylight saving time (São Paulo, 2018-2019)', () => {
  it('jumps from 23:59 to 01:00 when DST starts on 04/11/2018', () => {
    expect(formatDateTime('2018-11-04T02:59:00Z', SAO_PAULO)).toBe(
      'sábado, 03/11/2018 às 23:59',
    )
    expect(formatDateTime('2018-11-04T03:00:00Z', SAO_PAULO)).toBe(
      'domingo, 04/11/2018 às 01:00',
    )
    expect(formatTime('2018-11-04T01:00:00-02:00', SAO_PAULO)).toBe('01:00')
  })

  it('shows both occurrences of the repeated hour when DST ends on 17/02/2019', () => {
    const first = '2019-02-16T23:30:00-02:00'
    const second = '2019-02-16T23:30:00-03:00'
    expect(parseInstant(second).getTime() - parseInstant(first).getTime()).toBe(3_600_000)
    for (const instant of [first, second]) {
      expect(formatDateTime(instant, SAO_PAULO)).toBe('sábado, 16/02/2019 às 23:30')
    }
  })

  it('measures an interval across the change in real time', () => {
    // 23:30 (-03) to 01:30 (-02): one hour in real time.
    expect(formatTimeRange('2018-11-04T02:30:00Z', '2018-11-04T03:30:00Z', SAO_PAULO)).toBe(
      '03/11/2018 23:30 – 04/11/2018 01:30',
    )
  })
})

describe('time zone without daylight saving time', () => {
  it('keeps the same offset all year (Asia/Kolkata, +05:30)', () => {
    expect(formatTime('2026-01-15T03:30:00Z', 'Asia/Kolkata')).toBe('09:00')
    expect(formatTime('2026-07-15T03:30:00Z', 'Asia/Kolkata')).toBe('09:00')
  })

  it('formats São Paulo after 2019, without DST', () => {
    expect(formatTime('2026-01-15T12:00:00Z', SAO_PAULO)).toBe('09:00')
    expect(formatTime('2026-07-15T12:00:00Z', SAO_PAULO)).toBe('09:00')
  })
})

describe('formatTimeRange', () => {
  it('shows only the hours on the same local day', () => {
    expect(formatTimeRange('2026-11-10T12:00:00Z', '2026-11-10T12:30:00Z', SAO_PAULO)).toBe(
      '09:00–09:30',
    )
  })

  it('uses the local day of the business, not the UTC day', () => {
    // 21:00 to 23:30 in São Paulo, though it ends on 11/11 in UTC.
    expect(formatTimeRange('2026-11-11T00:00:00Z', '2026-11-11T02:30:00Z', SAO_PAULO)).toBe(
      '21:00–23:30',
    )
  })
})

describe('parseInstant', () => {
  it.each(['2026-11-10T09:00:00', '2026-11-10', 'amanhã', '2026-11-10T09:00:00+0300'])(
    'refuses %s, which has no valid offset',
    (value) => {
      expect(() => parseInstant(value)).toThrow(RangeError)
    },
  )

  it('accepts fractions of a second and a lowercase z', () => {
    expect(parseInstant('2026-11-10T12:00:00.123z').toISOString()).toBe('2026-11-10T12:00:00.123Z')
  })

  it('refuses an invalid date', () => {
    expect(() => parseInstant('2026-13-40T12:00:00Z')).toThrow(RangeError)
    expect(() => parseInstant(new Date(Number.NaN))).toThrow(RangeError)
  })
})

describe('formatLocalDate', () => {
  it('formats a calendar day of the business without shifting it', () => {
    expect(formatLocalDate('2026-11-10')).toBe('terça-feira, 10/11/2026')
    expect(formatLocalDate('2018-11-04')).toBe('domingo, 04/11/2018')
  })

  it.each(['2026-02-30', '10/11/2026', '2026-11-10T00:00:00Z'])('refuses %s', (value) => {
    expect(() => formatLocalDate(value)).toThrow(RangeError)
  })
})
