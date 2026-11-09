import { QueryClient, type DefaultOptions } from '@tanstack/react-query'

import { ApiError, NetworkError } from './errors'

/** At most 2 automatic retries, and only for reads (D53). */
export const MAX_QUERY_RETRIES = 2

/**
 * Retries a read only when the API could not answer: a `NetworkError` or a
 * `5xx`. A `4xx` is a final answer (including `429`), so it is never repeated.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false
  if (error instanceof NetworkError) return true
  return error instanceof ApiError && error.status >= 500
}

export const queryDefaults: DefaultOptions = {
  queries: {
    retry: shouldRetryQuery,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  },
  // A mutation may have reached the API: repeating it could book twice.
  mutations: { retry: false },
}

export function createQueryClient(overrides: DefaultOptions = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { ...queryDefaults.queries, ...overrides.queries },
      mutations: { ...queryDefaults.mutations, ...overrides.mutations },
    },
  })
}
