import { describe, expect, it } from 'vitest'

import { formatDuration, formatPrice } from './format'

describe('formatPrice (D63)', () => {
  it.each([
    [5000, 'R$ 50,00'],
    [3550, 'R$ 35,50'],
    [0, 'R$ 0,00'],
    [100000000, 'R$ 1.000.000,00'],
  ])('formats %i cents as %s', (cents, text) => {
    expect(formatPrice(cents)).toBe(text)
  })
})

describe('formatDuration', () => {
  it.each([
    [15, '15 min'],
    [60, '1 h'],
    [90, '1 h 30 min'],
    [1440, '24 h'],
  ])('formats %i minutes as %s', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text)
  })
})
