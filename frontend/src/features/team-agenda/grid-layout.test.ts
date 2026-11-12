import { describe, expect, it } from 'vitest'

import { staffAppointment } from '@/test/msw/team-agenda'

import { DEFAULT_HOURS, hourRange, layoutColumn } from './grid-layout'

const SAO_PAULO = 'America/Sao_Paulo'

describe('hours of the grid (D80)', () => {
  it('shows 08:00 to 20:00 on a quiet day', () => {
    expect(hourRange([], SAO_PAULO)).toEqual(DEFAULT_HOURS)
  })

  it('widens to fit an early or a late block, with its preparation', () => {
    const early = staffAppointment({ id: 'a', local: '2026-11-12T07:10' })
    const late = staffAppointment({ id: 'b', local: '2026-11-12T19:40' })
    expect(hourRange([early, late], SAO_PAULO)).toEqual({ from: 7, to: 21 })
  })
})

describe('blocks of a column', () => {
  it('places each block at its exact minute, off the grid (RN19)', () => {
    const [placed] = layoutColumn([staffAppointment({ id: 'a', local: '2026-11-12T09:07' })], SAO_PAULO)
    expect(placed).toMatchObject({ start: 547, end: 577, blockedEnd: 587, lane: 0, lanes: 1 })
  })

  it('puts overlapping blocks side by side, and frees the lane after the preparation', () => {
    const items = [
      staffAppointment({ id: 'c', local: '2026-11-12T09:40' }),
      staffAppointment({ id: 'a', local: '2026-11-12T09:00' }),
      staffAppointment({ id: 'b', local: '2026-11-12T09:15' }),
      staffAppointment({ id: 'd', local: '2026-11-12T11:00' }),
    ]
    const lanes = Object.fromEntries(
      layoutColumn(items, SAO_PAULO).map((item) => [item.appointment.id, [item.lane, item.lanes]]),
    )
    // "a" ends its preparation at 09:40, so "c" takes its lane; "d" is alone.
    expect(lanes).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] })
  })

  it('stops a block that crosses midnight at the end of the day', () => {
    const [placed] = layoutColumn([staffAppointment({ id: 'a', local: '2026-11-12T23:45' })], SAO_PAULO)
    expect(placed).toMatchObject({ start: 1425, end: 1440, blockedEnd: 1440 })
  })
})
