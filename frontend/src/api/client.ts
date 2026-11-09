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

/** Returns the current access token, or `null` without a session. */
export type AccessTokenProvider = () => string | null

/** Routes that use the refresh cookie and require `X-Requested-With` (CSRF). */
export const COOKIE_ROUTES: ReadonlySet<string> = new Set(['/api/v1/auth/refresh', '/api/v1/auth/logout'])

export const REQUESTED_WITH = 'agenda-inteligente'

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''

export interface ApiClientOptions {
  baseUrl?: string
  getAccessToken?: AccessTokenProvider
  fetch?: (input: Request) => Promise<Response>
}

export function createApiClient(options: ApiClientOptions = {}) {
  const getAccessToken = options.getAccessToken ?? (() => null)

  const middleware: Middleware = {
    onRequest({ request, schemaPath }) {
      const token = getAccessToken()
      if (token !== null && !request.headers.has('Authorization')) {
        request.headers.set('Authorization', `Bearer ${token}`)
      }
      if (COOKIE_ROUTES.has(schemaPath)) {
        request.headers.set('X-Requested-With', REQUESTED_WITH)
      }
      return request
    },
    async onResponse({ response }) {
      if (!response.ok) throw await toApiError(response)
      return undefined
    },
    onError({ error }) {
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
    fetch: options.fetch ?? ((request: Request) => globalThis.fetch(request)),
  })
  client.use(middleware)
  return client
}

export type ApiClient = ReturnType<typeof createApiClient>

let currentAccessTokenProvider: AccessTokenProvider = () => null

/** The login step plugs the session in here; until then, no token is sent. */
export function setAccessTokenProvider(provider: AccessTokenProvider): void {
  currentAccessTokenProvider = provider
}

/** The client used by the application. */
export const api: ApiClient = createApiClient({
  getAccessToken: () => currentAccessTokenProvider(),
})

/** Unwraps `data` from a call of the client, which already throws on errors. */
export async function unwrap<T>(call: Promise<{ data?: T; response: Response }>): Promise<T> {
  const { data } = await call
  return data as T
}
