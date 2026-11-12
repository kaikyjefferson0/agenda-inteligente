import createClient, { type Middleware } from 'openapi-fetch'

import { isAbortError, NetworkError, toApiError } from './errors'
import type { paths } from './schema'

/**
 * Typed client of the API (D51 to D53).
 *
 * The paths of `schema.d.ts` already carry the `/api/v1` prefix, so the base URL
 * is only the origin: empty in development, where Vite forwards `/api` to the
 * API (same origin), and `VITE_API_BASE_URL` in production.
 *
 * Every call either resolves with the data or throws: `ApiError` for a response
 * outside 2xx and `NetworkError` when the request never gets an answer.
 */

/**
 * Returns the current access token, or `null` without a session. It may be
 * asynchronous: the session renews a token about to expire before handing it
 * out (D72).
 */
export type AccessTokenProvider = () => string | null | Promise<string | null>

/**
 * Called once after a `401` on a request that carried a token: returns a new
 * token to retry with, or `null` when the session is over (D72).
 */
export type UnauthorizedHandler = () => Promise<string | null>

/** Routes that use the refresh cookie and require `X-Requested-With` (CSRF). */
export const COOKIE_ROUTES: ReadonlySet<string> = new Set(['/api/v1/auth/refresh', '/api/v1/auth/logout'])

export const REQUESTED_WITH = 'agenda-inteligente'

/**
 * Routes that never carry the access token: the public pages and the account
 * routes, except `/auth/me`. Asking the session for a token here could wait on
 * the refresh that is itself one of these requests.
 */
export function sendsAccessToken(schemaPath: string): boolean {
  if (schemaPath.startsWith('/api/v1/public/')) return false
  if (schemaPath.startsWith('/api/v1/auth/')) return schemaPath === '/api/v1/auth/me'
  return true
}

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''

export interface ApiClientOptions {
  baseUrl?: string
  getAccessToken?: AccessTokenProvider
  onUnauthorized?: UnauthorizedHandler
  fetch?: (input: Request) => Promise<Response>
}

export function createApiClient(options: ApiClientOptions = {}) {
  const getAccessToken = options.getAccessToken ?? (() => null)
  const onUnauthorized = options.onUnauthorized
  const fetchFn = options.fetch ?? ((request: Request) => globalThis.fetch(request))
  // Copies of the requests sent with a session token, for one retry after a 401.
  const retryable = new Map<string, Request>()

  const middleware: Middleware = {
    async onRequest({ request, schemaPath, id }) {
      if (sendsAccessToken(schemaPath) && !request.headers.has('Authorization')) {
        const token = await getAccessToken()
        if (token !== null) {
          request.headers.set('Authorization', `Bearer ${token}`)
          if (onUnauthorized !== undefined) retryable.set(id, request.clone())
        }
      }
      if (COOKIE_ROUTES.has(schemaPath)) {
        request.headers.set('X-Requested-With', REQUESTED_WITH)
      }
      return request
    },
    async onResponse({ response, id }) {
      const copy = retryable.get(id)
      retryable.delete(id)
      if (response.status === 401 && copy !== undefined && onUnauthorized !== undefined) {
        const token = await onUnauthorized()
        if (token !== null) {
          copy.headers.set('Authorization', `Bearer ${token}`)
          const retried = await fetchFn(copy)
          if (!retried.ok) throw await toApiError(retried)
          return retried
        }
      }
      if (!response.ok) throw await toApiError(response)
      return undefined
    },
    onError({ error, id }) {
      retryable.delete(id)
      // A cancelled query keeps its AbortError, so TanStack Query ignores it.
      if (isAbortError(error)) return error as Error
      return new NetworkError(error)
    },
  }

  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? API_BASE_URL,
    // In production the API is another subdomain: the refresh cookie needs it.
    credentials: 'include',
    // Resolved on each call, not when the client is created: the module-level
    // client must see a fetch patched later (MSW in the tests, for instance).
    fetch: fetchFn,
  })
  client.use(middleware)
  return client
}

export type ApiClient = ReturnType<typeof createApiClient>

let currentAccessTokenProvider: AccessTokenProvider = () => null
let currentUnauthorizedHandler: UnauthorizedHandler = () => Promise.resolve(null)

/** The session (src/features/auth) plugs in here; until then, no token is sent. */
export function setAccessTokenProvider(provider: AccessTokenProvider): void {
  currentAccessTokenProvider = provider
}

/** The session plugs in the renewal used after a `401` (D72). */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  currentUnauthorizedHandler = handler
}

/** The client used by the application. */
export const api: ApiClient = createApiClient({
  getAccessToken: () => currentAccessTokenProvider(),
  onUnauthorized: () => currentUnauthorizedHandler(),
})

/** Unwraps `data` from a call of the client, which already throws on errors. */
export async function unwrap<T>(call: Promise<{ data?: T; response: Response }>): Promise<T> {
  const { data } = await call
  return data as T
}
