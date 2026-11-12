import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { nextAttempt, useIdempotencyKey } from './idempotency'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('nextAttempt (D64)', () => {
  let counter = 0
  const newKey = () => `key-${++counter}`

  it('keeps the key while the body is the same', () => {
    const first = nextAttempt(null, { a: 1 }, newKey)
    expect(nextAttempt(first, { a: 1 }, newKey)).toBe(first)
  })

  it('starts a new attempt when the body changes', () => {
    const first = nextAttempt(null, { a: 1 }, newKey)
    const second = nextAttempt(first, { a: 2 }, newKey)
    expect(second.key).not.toBe(first.key)
  })
})

describe('useIdempotencyKey', () => {
  it('gives a UUID, reused for the same body and replaced after reset', () => {
    const { result } = renderHook(() => useIdempotencyKey())
    const body = { starts_at: '2026-11-10T09:00:00-03:00' }

    const first = result.current.keyFor(body)
    expect(first).toMatch(UUID)
    expect(result.current.keyFor({ ...body })).toBe(first)
    expect(result.current.keyFor({ starts_at: '2026-11-10T14:00:00-03:00' })).not.toBe(first)

    const again = result.current.keyFor(body)
    act(() => result.current.reset())
    expect(result.current.keyFor(body)).not.toBe(again)
  })
})
