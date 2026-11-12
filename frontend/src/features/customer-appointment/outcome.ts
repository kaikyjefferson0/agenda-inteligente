import { ApiError } from '@/api/errors'

import type { CustomerChange } from './queries'

/** What the page tells after a change was answered (D67). */
export type Outcome =
  | { kind: 'cancelled' | 'rescheduled'; emailStatus: CustomerChange['email_status'] }
  /** A final refusal: the link was read again and shows why. */
  | { kind: 'refused'; error: unknown }

/**
 * Refusals that a new attempt cannot fix, because the link itself changed:
 * replaced or expired (`404`), past the deadline or no longer confirmed
 * (`409`). The page reads the link again instead of offering a retry.
 */
export function isFinalRefusal(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return (
    error.status === 404 ||
    error.code === 'CHANGE_DEADLINE_PASSED' ||
    error.code === 'INVALID_STATUS_TRANSITION'
  )
}
