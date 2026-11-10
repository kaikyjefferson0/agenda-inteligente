import { describe, expect, it } from 'vitest'

import { formatDemoDay, nextDemoDay } from './demo-preview'

describe('nextDemoDay', () => {
  it('keeps a working day', () => {
    // Tuesday, 10/11/2026, 09:00 in São Paulo.
    expect(nextDemoDay('2026-11-10T12:00:00Z')).toBe('2026-11-10')
    // Saturday.
    expect(nextDemoDay('2026-11-14T12:00:00Z')).toBe('2026-11-14')
  })

  it('jumps Sunday and Monday to Tuesday', () => {
    expect(nextDemoDay('2026-11-15T12:00:00Z')).toBe('2026-11-17')
    expect(nextDemoDay('2026-11-16T12:00:00Z')).toBe('2026-11-17')
  })

  it('uses the day of the business, not the one of the browser', () => {
    // Tuesday 01:00 UTC is still Monday 22:00 in São Paulo (and Tuesday in Tokyo).
    expect(nextDemoDay('2026-11-10T01:00:00Z')).toBe('2026-11-10')
    // Saturday 23:30 in São Paulo is already Sunday in UTC and in Tokyo.
    expect(nextDemoDay('2026-11-15T02:30:00Z')).toBe('2026-11-14')
  })

  it('crosses the end of the month and of the year', () => {
    expect(nextDemoDay('2026-11-30T12:00:00Z')).toBe('2026-12-01')
    expect(nextDemoDay('2028-01-02T12:00:00Z')).toBe('2028-01-04')
  })
})

describe('formatDemoDay', () => {
  it('shows the weekday and the date without the year', () => {
    expect(formatDemoDay('2026-11-10')).toBe('terça-feira, 10/11')
  })
})
