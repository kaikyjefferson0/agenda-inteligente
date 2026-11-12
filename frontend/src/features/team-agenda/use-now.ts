import { useEffect, useState } from 'react'

import { parseInstant, type Instant } from '@/lib/datetime'

/** The longest delay `setTimeout` takes (about 24.8 days); longer ones fire at once. */
const MAX_DELAY = 2 ** 31 - 1

/** The current time, read again every `intervalMs` (the "now" line of the agenda). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * Whether `instant` already came, turning true at that very moment without a
 * reload: the result of an appointment opens at its start (RN15, D84).
 */
export function useReached(instant: Instant): boolean {
  const at = parseInstant(instant).getTime()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let timer: number | undefined
    const check = () => {
      const current = Date.now()
      setNow(current)
      // A long wait is cut in pieces: past the limit, setTimeout fires at once.
      if (current < at) timer = window.setTimeout(check, Math.min(MAX_DELAY, at - current))
    }
    check()
    return () => window.clearTimeout(timer)
  }, [at])

  return now >= at
}
