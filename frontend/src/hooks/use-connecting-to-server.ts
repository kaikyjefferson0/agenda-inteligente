import { useIsFetching } from '@tanstack/react-query'

import { isColdStartError } from '@/api/query-client'

/**
 * Failures in a row before the notice shows: one failure may be a blip, and
 * the first retry comes 1 s later (D112), so the notice does not flash.
 */
export const CONNECTING_AFTER_FAILURES = 2

/**
 * D112: whether a read is still retrying because the API is not answering yet
 * (it sleeps on the free plan). Paused reads, without a network, do not count:
 * the notice of "sem conexão" covers them (D99).
 */
export function useConnectingToServer(): boolean {
  const retrying = useIsFetching({
    predicate: (query) =>
      query.state.fetchFailureCount >= CONNECTING_AFTER_FAILURES &&
      isColdStartError(query.state.fetchFailureReason),
  })
  return retrying > 0
}
