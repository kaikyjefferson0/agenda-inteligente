import { describe, expect, it } from 'vitest'

import { weekDays, weekPeriod, weekStartOf } from './period'

const SAO_PAULO = 'America/Sao_Paulo'

describe('the week of the agenda (D78)', () => {
  it('starts on Monday, as the weekday 0 of the API', () => {
    expect(weekStartOf('2026-11-12')).toBe('2026-11-09')
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09')
    expect(weekStartOf('2026-11-15')).toBe('2026-11-09')
    expect(weekDays('2026-11-09')).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ])
  })

  it('asks from the first instant of Monday to the next Monday, in the business', () => {
    expect(weekPeriod('2026-11-09', SAO_PAULO)).toEqual({
      from: '2026-11-09T03:00:00Z',
      to: '2026-11-16T03:00:00Z',
    })
  })

  it('has 167 hours in the week daylight time started, far below the 31 days', () => {
    const { from, to } = weekPeriod('2018-10-29', SAO_PAULO)
    expect(from).toBe('2018-10-29T03:00:00Z')
    expect(to).toBe('2018-11-05T02:00:00Z')
    expect((Date.parse(to) - Date.parse(from)) / 3_600_000).toBe(167)
  })
})
