import { describe, expect, it } from 'vitest'

import { secondsLeft, waitLabel } from './use-retry-after'

describe('secondsLeft', () => {
  it('is 0 without a deadline or after it', () => {
    expect(secondsLeft(null)).toBe(0)
    expect(secondsLeft(1_000, 5_000)).toBe(0)
  })

  it('rounds up', () => {
    expect(secondsLeft(2_500, 1_000)).toBe(2)
  })
})

describe('waitLabel', () => {
  it('uses seconds below one minute and minutes above it', () => {
    expect(waitLabel(59)).toBe('Aguarde 59 s')
    expect(waitLabel(60)).toBe('Aguarde 1 min')
    expect(waitLabel(3_412)).toBe('Aguarde 57 min')
  })
})
