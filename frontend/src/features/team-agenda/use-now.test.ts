import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNow, useReached } from './use-now'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-12T16:59:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('clock of the agenda', () => {
  it('opens the result at the start itself, without a reload (D84)', () => {
    const { result } = renderHook(() => useReached('2026-11-12T17:00:00Z'))
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(59_000))
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(1_000))
    expect(result.current).toBe(true)
  })

  it('is already true for an instant in the past', () => {
    const { result } = renderHook(() => useReached('2026-11-12T16:00:00Z'))
    expect(result.current).toBe(true)
  })

  it('reads the time again every half minute', () => {
    const { result } = renderHook(() => useNow())
    act(() => vi.advanceTimersByTime(30_000))
    expect(result.current).toEqual(new Date('2026-11-12T16:59:30Z'))
  })
})
