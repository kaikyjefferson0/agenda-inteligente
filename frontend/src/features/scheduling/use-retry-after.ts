import { useCallback, useEffect, useState } from 'react'

import { ApiError } from '@/api/errors'

/** Seconds left until `until`, rounded up; 0 once it passed. */
export function secondsLeft(until: number | null, now = Date.now()): number {
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000))
}

/**
 * `429` with `Retry-After`: counts down the wait, so the action stays held
 * (and its button says "Aguarde N s") until it ends.
 */
export function useRetryAfter() {
  const [until, setUntil] = useState<number | null>(null)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (until === null) return
    const tick = () => {
      const left = secondsLeft(until)
      setWait(left)
      if (left === 0) setUntil(null)
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [until])

  /** Starts the countdown when `error` is a `429` that says how long to wait. */
  const holdFor = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 429 && error.retryAfterSeconds !== null) {
      setUntil(Date.now() + error.retryAfterSeconds * 1000)
    }
  }, [])

  /** Read on submit, before React redraws the button. */
  const holding = useCallback(() => secondsLeft(until) > 0, [until])

  return { wait, waiting: wait > 0, holdFor, holding }
}
