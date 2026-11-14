import { API_BASE_URL } from './client'

/**
 * D112: on opening the site, wakes the API up (the free plan sleeps) while the
 * page loads. `/health` does not touch the database (D118), so the database
 * stays asleep until a real request. Without credentials and `no-cors`: no
 * preflight, no cookie, and the answer is never read. Skipped when the API is
 * on the same origin (development and E2E), where it is already awake and
 * `/health` is not forwarded to it.
 */
export function warmUpApi(
  baseUrl: string = API_BASE_URL,
  fetchFn: typeof fetch = (input, init) => globalThis.fetch(input, init),
): void {
  if (baseUrl === '') return
  fetchFn(`${baseUrl}/health`, { mode: 'no-cors', credentials: 'omit', cache: 'no-store' }).catch(() => {
    // A sleeping API may drop it: the reads have their own retries.
  })
}
