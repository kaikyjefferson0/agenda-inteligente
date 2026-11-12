import { describe, expect, it } from 'vitest'

import { BRUNO_ID, staffAppointment, WORKING_INTERVALS } from '@/test/msw/team-agenda'

import {
  busyRangesOf,
  checkSlot,
  formatRanges,
  freeRanges,
  workingRangesOf,
  type Range,
} from './slot-check'

const SAO_PAULO = 'America/Sao_Paulo'
const NOW = new Date('2026-11-12T16:00:00Z') // 13:00 of Thursday in São Paulo
const WORKING: Range[] = [
  { start: 540, end: 720 },
  { start: 780, end: 1140 },
]

describe('working hours of the day', () => {
  it('takes the intervals of the weekday, from Monday as 0', () => {
    expect(workingRangesOf(WORKING_INTERVALS, '2026-11-12')).toEqual(WORKING)
    expect(workingRangesOf(WORKING_INTERVALS, '2026-11-15')).toEqual([])
  })

  it('reads them as ranges', () => {
    expect(formatRanges(WORKING)).toBe('09:00–12:00 e 13:00–19:00')
    expect(formatRanges([...WORKING, { start: 1200, end: 1260 }])).toBe(
      '09:00–12:00, 13:00–19:00 e 20:00–21:00',
    )
    expect(formatRanges([{ start: 540, end: 720 }])).toBe('09:00–12:00')
  })
})

describe('busy time of the professional', () => {
  it('counts the preparation and the blocks, not the cancelled, the others nor the rescheduled one', () => {
    const appointments = [
      staffAppointment({ id: 'a', local: '2026-11-12T09:00' }),
      staffAppointment({ id: 'b', local: '2026-11-12T10:00', status: 'cancelled' }),
      staffAppointment({ id: 'c', local: '2026-11-12T11:00', professional_id: 'outro' }),
      staffAppointment({ id: 'd', local: '2026-11-12T14:00' }),
    ]
    const blocks = [
      {
        id: 'x',
        professional_id: BRUNO_ID,
        // From 17:00 of the day before to 10:00: only the part inside the day counts.
        starts_at: '2026-11-11T20:00:00Z',
        ends_at: '2026-11-12T13:00:00Z',
        reason: 'Médico',
      },
    ]
    expect(busyRangesOf(BRUNO_ID, appointments, blocks, '2026-11-12', SAO_PAULO, 'd')).toEqual([
      { start: 0, end: 600 },
      { start: 540, end: 580 },
    ])
  })

  it('runs to the end of the day when a block goes past midnight', () => {
    const blocks = [
      {
        id: 'x',
        professional_id: BRUNO_ID,
        starts_at: '2026-11-12T21:00:00Z',
        ends_at: '2026-11-13T12:00:00Z',
        reason: 'Viagem',
      },
    ]
    expect(busyRangesOf(BRUNO_ID, [], blocks, '2026-11-12', SAO_PAULO)).toEqual([{ start: 1080, end: 1440 }])
    expect(busyRangesOf(BRUNO_ID, [], blocks, '2026-11-14', SAO_PAULO)).toEqual([])
  })
})

describe('free ranges (D82)', () => {
  const busy = [
    { start: 555, end: 575 },
    { start: 810, end: 875 },
    { start: 900, end: 940 },
  ]

  it('keeps only the room where the whole block fits in one interval', () => {
    expect(freeRanges(WORKING, busy, 65, null)).toEqual([
      { start: 575, end: 720 },
      { start: 940, end: 1140 },
    ])
  })

  it('starts after now on today', () => {
    expect(freeRanges(WORKING, busy, 30, 1000)).toEqual([{ start: 1000, end: 1140 }])
    expect(freeRanges(WORKING, [], 30, 1440)).toEqual([])
  })
})

describe('the time typed by the team (RN19)', () => {
  const check = (time: string, localDate = '2026-11-12', working: Range[] | undefined = WORKING) =>
    checkSlot({ localDate, time, timeZone: SAO_PAULO, now: NOW, working, blockMinutes: 40 })

  it('accepts any minute within the working hours', () => {
    expect(check('14:07')).toEqual({ ok: true, instant: new Date('2026-11-12T17:07:00Z') })
    expect(check('18:20')).toMatchObject({ ok: true })
  })

  it.each([
    ['', 'invalid'],
    ['12:30', 'in_past'],
    ['18:21', 'outside_working_hours'],
  ])('refuses %s as %s', (time, problem) => {
    expect(check(time)).toEqual({ ok: false, problem })
  })

  it('refuses a block that crosses the lunch break', () => {
    expect(check('11:30', '2026-11-13')).toEqual({ ok: false, problem: 'outside_working_hours' })
  })

  it('checks only the past while the working hours load', () => {
    const loading = checkSlot({
      localDate: '2026-11-13',
      time: '22:00',
      timeZone: SAO_PAULO,
      now: NOW,
      working: undefined,
      blockMinutes: 40,
    })
    expect(loading).toMatchObject({ ok: true })
  })

  it('refuses a local time that did not exist', () => {
    const skipped = checkSlot({
      localDate: '2018-11-04',
      time: '00:30',
      timeZone: SAO_PAULO,
      now: new Date('2018-01-01T00:00:00Z'),
      working: undefined,
      blockMinutes: 30,
    })
    expect(skipped).toEqual({ ok: false, problem: 'nonexistent' })
  })
})
