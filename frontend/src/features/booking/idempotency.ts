import { useCallback, useRef } from 'react'

/**
 * Idempotency of the public booking (RN13, D64).
 *
 * One key per attempt, where an attempt is one exact body: sending the same
 * body again (a second click, a retry after a network failure) reuses the
 * key, so the API answers with the same appointment instead of a new one. Any
 * change in the body (another slot after a `409`, a corrected phone after a
 * `422`) starts a new attempt with a new key, so it never meets
 * `IDEMPOTENCY_KEY_REUSED`.
 */

export interface Attempt {
  key: string
  fingerprint: string
}

export function fingerprintOf(body: unknown): string {
  return JSON.stringify(body)
}

/** The attempt for `body`: the previous one when the body is the same. */
export function nextAttempt(
  previous: Attempt | null,
  body: unknown,
  newKey: () => string = () => crypto.randomUUID(),
): Attempt {
  const fingerprint = fingerprintOf(body)
  if (previous !== null && previous.fingerprint === fingerprint) return previous
  return { key: newKey(), fingerprint }
}

export function useIdempotencyKey() {
  const attempt = useRef<Attempt | null>(null)

  const keyFor = useCallback((body: unknown): string => {
    attempt.current = nextAttempt(attempt.current, body)
    return attempt.current.key
  }, [])

  /** Forgets the attempt, e.g. after `IDEMPOTENCY_KEY_REUSED`. */
  const reset = useCallback(() => {
    attempt.current = null
  }, [])

  return { keyFor, reset }
}
