import { QueryClient, type DefaultOptions } from '@tanstack/react-query'

import { ApiError, NetworkError } from './errors'

/** At most 2 automatic retries of a read the API answered with a `5xx` (D53). */
export const MAX_QUERY_RETRIES = 2

/**
 * D112: the waits between the retries while the API wakes up (the free plan
 * takes about a minute), growing and then every 15 s, about 90 s in all.
 */
export const COLD_START_RETRY_DELAYS_MS: readonly number[] = [
  1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000, 15_000, 15_000,
]

/**
 * D112: the failures of an API that is not answering yet: no answer at all
 * (`NetworkError`) or a `5xx` without the API's `code`, the page of the
 * platform in front of it. A `5xx` with a `code` came from the API itself.
 */
export function isColdStartError(error: unknown): boolean {
  if (error instanceof NetworkError) return true
  return error instanceof ApiError && error.status >= 500 && error.code === null
}

/**
 * Retries a read only when the API could not answer. A cold start (D112) is
 * retried for about 90 s; a `5xx` of the API, at most twice (D53). A `4xx` is
 * a final answer (including `429`), so it is never repeated.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isColdStartError(error)) return failureCount < COLD_START_RETRY_DELAYS_MS.length
  if (failureCount >= MAX_QUERY_RETRIES) return false
  return error instanceof ApiError && error.status >= 500
}

/** The wait before retry number `failureCount + 1`. */
export function queryRetryDelay(failureCount: number, error: unknown): number {
  if (isColdStartError(error)) {
    return COLD_START_RETRY_DELAYS_MS[Math.min(failureCount, COLD_START_RETRY_DELAYS_MS.length - 1)]
  }
  // The default of TanStack Query.
  return Math.min(1_000 * 2 ** failureCount, 30_000)
}

export const queryDefaults: DefaultOptions = {
  queries: {
    retry: shouldRetryQuery,
    retryDelay: queryRetryDelay,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  },
  // A mutation may have reached the API: repeating it could book twice.
  // Without a network it fails at once, with the message of connection, and
  // never waits to go by itself when the network returns: cancelling or
  // booking minutes later, without the person seeing it, is worse (D99).
  // Reads keep the default `online` mode: they pause and resume.
  mutations: { retry: false, networkMode: 'always' },
}

export function createQueryClient(overrides: DefaultOptions = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { ...queryDefaults.queries, ...overrides.queries },
      mutations: { ...queryDefaults.mutations, ...overrides.mutations },
    },
  })
}
