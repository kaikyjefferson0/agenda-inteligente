import { describe, expect, it } from 'vitest'

import {
  addInterval,
  changeInterval,
  copyDay,
  daySummary,
  draftOf,
  intervalsOf,
  problemsOf,
  removeInterval,
  sameWeek,
} from './week-draft'

const LUNCH = [
  { weekday: 0, start_time: '09:00', end_time: '12:00' },
  { weekday: 0, start_time: '13:00', end_time: '18:00' },
]

describe('week draft (UC08)', () => {
  it('reads the API by weekday and in order, and sends the same back', () => {
    const week = draftOf([LUNCH[1], { weekday: 6, start_time: '10:00:00', end_time: '14:00:00' }, LUNCH[0]])
    expect(week).toHaveLength(7)
    expect(week[0].map((item) => `${item.start}-${item.end}`)).toEqual(['09:00-12:00', '13:00-18:00'])
    expect(week[6][0]).toMatchObject({ start: '10:00', end: '14:00' })
    expect(intervalsOf(week)).toEqual([...LUNCH, { weekday: 6, start_time: '10:00', end_time: '14:00' }])
  })

  it('sends an empty list for a closed week', () => {
    expect(intervalsOf(draftOf([]))).toEqual([])
  })

  it('accepts a lunch break and touching intervals', () => {
    expect(problemsOf(draftOf(LUNCH))).toEqual([])
    const touching = draftOf([
      { weekday: 1, start_time: '09:00', end_time: '12:00' },
      { weekday: 1, start_time: '12:00', end_time: '18:00' },
    ])
    expect(problemsOf(touching)).toEqual([])
  })

  it('refuses an end not after the start, on the end', () => {
    const week = draftOf([{ weekday: 2, start_time: '12:00', end_time: '09:00' }])
    expect(problemsOf(week)).toEqual([
      { weekday: 2, key: week[2][0].key, field: 'end', message: 'O fim precisa ser depois do início (12:00).' },
    ])
    const same = changeInterval(week, 2, week[2][0].key, { end: '12:00' })
    expect(problemsOf(same)).toHaveLength(1)
  })

  it('refuses overlapping intervals on the later one, whatever the order of the fields', () => {
    const week = draftOf([
      { weekday: 3, start_time: '13:00', end_time: '18:00' },
      { weekday: 3, start_time: '09:00', end_time: '14:00' },
    ])
    const later = week[3].find((item) => item.start === '13:00')!
    expect(problemsOf(week)).toEqual([
      {
        weekday: 3,
        key: later.key,
        field: 'start',
        message: 'Sobrepõe o intervalo 09:00–14:00. Comece às 14:00 ou depois.',
      },
    ])
    // The same hours on another day do not overlap.
    expect(problemsOf(draftOf([LUNCH[0], { ...LUNCH[0], weekday: 1 }]))).toEqual([])
  })

  it('refuses empty times', () => {
    const week = changeInterval(draftOf(LUNCH), 0, draftOf(LUNCH)[0][0].key, {})
    const key = week[0][0].key
    const cleared = changeInterval(week, 0, key, { start: '', end: '' })
    expect(problemsOf(cleared).map((problem) => problem.field)).toEqual(['start', 'end'])
  })

  it('adds an interval after the last one, or 09:00–18:00 on a closed day', () => {
    const closed = addInterval(draftOf([]), 4)
    expect(closed[4][0]).toMatchObject({ start: '09:00', end: '18:00' })
    const afterLunch = addInterval(draftOf([{ weekday: 4, start_time: '09:00', end_time: '12:00' }]), 4)
    expect(afterLunch[4][1]).toMatchObject({ start: '13:00', end: '17:00' })
    const late = addInterval(draftOf([{ weekday: 4, start_time: '20:00', end_time: '23:00' }]), 4)
    expect(late[4][1]).toMatchObject({ start: '23:00', end: '23:59' })
  })

  it('removes an interval', () => {
    const week = draftOf(LUNCH)
    expect(removeInterval(week, 0, week[0][0].key)[0].map((item) => item.start)).toEqual(['13:00'])
  })

  it('copies a day over others, closed ones included, with new keys', () => {
    const week = draftOf([...LUNCH, { weekday: 2, start_time: '10:00', end_time: '11:00' }])
    const copied = copyDay(week, 0, [1, 2, 0])
    expect(intervalsOf(copied).filter((item) => item.weekday === 1)).toEqual(
      LUNCH.map((item) => ({ ...item, weekday: 1 })),
    )
    expect(intervalsOf(copied).filter((item) => item.weekday === 2)).toEqual(
      LUNCH.map((item) => ({ ...item, weekday: 2 })),
    )
    expect(copied[1][0].key).not.toBe(week[0][0].key)
    expect(copied[0]).toBe(week[0])
    // Copying a closed day closes the targets.
    expect(copyDay(copied, 6, [1])[1]).toEqual([])
  })

  it('compares weeks by what they send', () => {
    expect(sameWeek(draftOf(LUNCH), draftOf([...LUNCH].reverse()))).toBe(true)
    expect(sameWeek(draftOf(LUNCH), draftOf([LUNCH[0]]))).toBe(false)
  })

  it('summarizes a day', () => {
    const week = draftOf([...LUNCH, { weekday: 0, start_time: '19:00', end_time: '21:00' }])
    expect(daySummary(week[0])).toBe('09:00–12:00, 13:00–18:00 e 19:00–21:00')
    expect(daySummary(draftOf([LUNCH[0]])[0])).toBe('09:00–12:00')
    expect(daySummary([])).toBe('Fechado')
    expect(daySummary([{ key: 'x', start: '', end: '10:00' }])).toBe('Horário incompleto')
  })
})
