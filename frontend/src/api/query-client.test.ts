import { QueryObserver } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { API, demoBusiness, problem } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'

import { createApiClient, unwrap } from './client'
import { ApiError, NetworkError } from './errors'
import { createQueryClient, MAX_QUERY_RETRIES, shouldRetryQuery } from './query-client'

const client = createApiClient({ baseUrl: 'http://api.test' })

/** Answers with `responses` in order, repeating the last one, and counts the calls. */
function sequence(...responses: Array<() => Response>) {
  let calls = 0
  server.use(
    http.get(`${API}/public/businesses/:slug`, () => {
      const response = responses[Math.min(calls, responses.length - 1)]
      calls += 1
      return response()
    }),
  )
  return () => calls
}

function testQueryClient() {
  return createQueryClient({ queries: { retryDelay: 0 } })
}

const fetchBusiness = () =>
  unwrap(
    client.GET('/api/v1/public/businesses/{slug}', {
      params: { path: { slug: 'barbearia-demo' } },
    }),
  )

async function runQuery() {
  const queryClient = testQueryClient()
  try {
    return await queryClient.fetchQuery({ queryKey: ['business'], queryFn: fetchBusiness })
  } finally {
    queryClient.clear()
  }
}

describe('shouldRetryQuery (D53)', () => {
  it('retries NetworkError and 5xx, at most twice', () => {
    const server500 = new ApiError({ status: 500, code: 'INTERNAL_ERROR' })
    expect(shouldRetryQuery(0, new NetworkError())).toBe(true)
    expect(shouldRetryQuery(1, server500)).toBe(true)
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, server500)).toBe(false)
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, new NetworkError())).toBe(false)
  })

  it('never retries a 4xx, including 429, nor unknown errors', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(shouldRetryQuery(0, new ApiError({ status }))).toBe(false)
    }
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(false)
  })
})

describe('QueryClient with the API', () => {
  it('repeats a read twice after 5xx and then succeeds', async () => {
    const calls = sequence(
      () => problem(503, 'DATABASE_UNAVAILABLE'),
      () => problem(500, 'INTERNAL_ERROR'),
      () => HttpResponse.json(demoBusiness),
    )

    await expect(runQuery()).resolves.toEqual(demoBusiness)
    expect(calls()).toBe(3)
  })

  it('gives up after 2 retries of a NetworkError', async () => {
    const calls = sequence(() => HttpResponse.error())

    await expect(runQuery()).rejects.toBeInstanceOf(NetworkError)
    expect(calls()).toBe(1 + MAX_QUERY_RETRIES)
  })

  it('does not repeat a 4xx', async () => {
    const calls = sequence(() => problem(429, 'RATE_LIMITED', {}, { 'Retry-After': '10' }))

    await expect(runQuery()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 10 })
    expect(calls()).toBe(1)
  })

  it('never repeats a mutation, even after a 5xx or a network failure', async () => {
    const queryClient = testQueryClient()
    for (const response of [() => problem(500, 'INTERNAL_ERROR'), () => HttpResponse.error()]) {
      let calls = 0
      server.use(
        http.post(`${API}/auth/login`, () => {
          calls += 1
          return response()
        }),
      )
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationFn: () =>
          unwrap(
            client.POST('/api/v1/auth/login', { body: { email: 'a@example.com', password: 'x' } }),
          ),
      })

      await expect(mutation.execute(undefined)).rejects.toBeDefined()
      expect(calls).toBe(1)
    }
  })

  it('applies the policy to observers too', async () => {
    const calls = sequence(() => problem(404, 'NOT_FOUND'))
    const queryClient = testQueryClient()
    const observer = new QueryObserver(queryClient, { queryKey: ['observed'], queryFn: fetchBusiness })

    const result = await new Promise<ReturnType<typeof observer.getCurrentResult>>((resolve) => {
      const stop = observer.subscribe((current) => {
        if (current.status === 'error') {
          stop()
          resolve(current)
        }
      })
    })

    expect(result.error).toBeInstanceOf(ApiError)
    expect(result.failureCount).toBe(1)
    expect(calls()).toBe(1)
    queryClient.clear()
  })
})
