import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'

import { server } from '@/test/msw/server'
import { API, demoBusiness, problem } from '@/test/msw/handlers'

import { api, createApiClient, REQUESTED_WITH, setAccessTokenProvider, unwrap } from './client'
import { ApiError, NetworkError, parseRetryAfter } from './errors'
import type { components } from './schema'

const client = createApiClient({ baseUrl: 'http://api.test' })

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the call to fail')
}

describe('success', () => {
  it('returns the typed data', async () => {
    const business = await unwrap(
      client.GET('/api/v1/public/businesses/{slug}', {
        params: { path: { slug: 'barbearia-demo' } },
      }),
    )

    expectTypeOf(business).toEqualTypeOf<components['schemas']['PublicBusinessResponse']>()
    expect(business).toEqual(demoBusiness)
  })

  it('uses VITE_API_BASE_URL in the default client (D52)', async () => {
    const { data, response } = await api.GET('/api/v1/public/businesses/{slug}', {
      params: { path: { slug: 'barbearia-demo' } },
    })
    expect(response.url).toBe(`${API}/public/businesses/barbearia-demo`)
    expect(data?.name).toBe('Barbearia Demo')
  })

  it('resolves a 204 without data', async () => {
    server.use(http.post(`${API}/auth/logout`, () => new HttpResponse(null, { status: 204 })))
    await expect(unwrap(client.POST('/api/v1/auth/logout'))).resolves.toBeUndefined()
  })
})

describe('errors (D53)', () => {
  it('turns problem+json into ApiError with code, title and detail', async () => {
    const error = await caught(
      client.GET('/api/v1/public/businesses/{slug}', { params: { path: { slug: 'nao-existe' } } }),
    )

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Título',
      detail: 'Detalhe.',
      fieldErrors: [],
      retryAfterSeconds: null,
    })
    expect((error as ApiError).hasCode('NOT_FOUND')).toBe(true)
  })

  it('reads the field errors of a 422 without the location prefix', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        problem(422, 'VALIDATION_ERROR', {
          errors: [
            { loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' },
            { loc: ['body', 'customer', 'phone'], msg: 'invalid phone', type: 'value_error' },
            { loc: ['query'], msg: 'missing', type: 'missing' },
            'not an object',
          ],
        }),
      ),
    )

    const error = (await caught(
      client.POST('/api/v1/auth/login', { body: { email: 'x', password: 'y' } }),
    )) as ApiError

    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.fieldErrors).toEqual([
      { field: 'email', message: 'value is not a valid email address', type: 'value_error' },
      { field: 'customer.phone', message: 'invalid phone', type: 'value_error' },
      { field: 'query', message: 'missing', type: 'missing' },
    ])
  })

  it('reads Retry-After in seconds on a 429', async () => {
    server.use(
      http.post(`${API}/auth/password/forgot`, () =>
        problem(429, 'RATE_LIMITED', {}, { 'Retry-After': '42' }),
      ),
    )

    const error = (await caught(
      client.POST('/api/v1/auth/password/forgot', { body: { email: 'a@example.com' } }),
    )) as ApiError

    expect(error.status).toBe(429)
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.retryAfterSeconds).toBe(42)
  })

  it('keeps the extra fields of the body, such as conflicts', async () => {
    server.use(
      http.post(`${API}/professionals/:id/deactivate`, () =>
        problem(409, 'APPOINTMENT_CONFLICTS', { conflicts: [{ id: 'a1' }] }),
      ),
    )

    const error = (await caught(
      client.POST('/api/v1/professionals/{professional_id}/deactivate', {
        params: { path: { professional_id: '5d0c7e42-0000-4000-8000-000000000002' } },
      }),
    )) as ApiError

    expect(error.body?.conflicts).toEqual([{ id: 'a1' }])
  })

  it('builds an ApiError without code from a body that is not a problem', async () => {
    server.use(
      http.get(`${API}/public/businesses/:slug`, () =>
        HttpResponse.text('Bad Gateway', { status: 502 }),
      ),
    )

    const error = (await caught(
      client.GET('/api/v1/public/businesses/{slug}', { params: { path: { slug: 'x' } } }),
    )) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 502, code: null, title: null, body: null })
    expect(error.message).toBe('HTTP 502')
  })

  it('ignores a JSON body that cannot be parsed or is not an object', async () => {
    server.use(
      http.get(`${API}/public/businesses/:slug`, ({ params }) =>
        params.slug === 'broken'
          ? new HttpResponse('{', { status: 500, headers: { 'Content-Type': 'application/json' } })
          : HttpResponse.json([1, 2], { status: 500 }),
      ),
    )

    for (const slug of ['broken', 'array']) {
      const error = (await caught(
        client.GET('/api/v1/public/businesses/{slug}', { params: { path: { slug } } }),
      )) as ApiError
      expect(error).toMatchObject({ status: 500, code: null, body: null })
    }
  })

  it('turns a network failure into NetworkError', async () => {
    server.use(http.get(`${API}/public/businesses/:slug`, () => HttpResponse.error()))

    const error = await caught(
      client.GET('/api/v1/public/businesses/{slug}', { params: { path: { slug: 'x' } } }),
    )

    expect(error).toBeInstanceOf(NetworkError)
    expect((error as NetworkError).cause).toBeDefined()
  })

  it('keeps the AbortError of a cancelled request', async () => {
    const controller = new AbortController()
    controller.abort()

    const error = await caught(
      client.GET('/api/v1/public/businesses/{slug}', {
        params: { path: { slug: 'barbearia-demo' } },
        signal: controller.signal,
      }),
    )

    expect(error).not.toBeInstanceOf(NetworkError)
    expect((error as Error).name).toBe('AbortError')
  })
})

describe('parseRetryAfter', () => {
  it('reads delta-seconds and HTTP dates', () => {
    const now = Date.parse('2026-11-10T12:00:00Z')
    expect(parseRetryAfter('120', now)).toBe(120)
    expect(parseRetryAfter(' 0 ', now)).toBe(0)
    expect(parseRetryAfter('Tue, 10 Nov 2026 12:00:30 GMT', now)).toBe(30)
    expect(parseRetryAfter('Tue, 10 Nov 2026 11:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfter('soon', now)).toBeNull()
    expect(parseRetryAfter(null, now)).toBeNull()
  })
})

describe('headers', () => {
  const seen: Record<string, Headers> = {}

  function record(path: string) {
    return http.post(`${API}${path}`, ({ request }) => {
      seen[path] = request.headers
      return new HttpResponse(null, { status: 204 })
    })
  }

  afterEach(() => {
    setAccessTokenProvider(() => null)
    for (const key of Object.keys(seen)) delete seen[key]
  })

  it('sends X-Requested-With only on /auth/refresh and /auth/logout', async () => {
    server.use(record('/auth/refresh'), record('/auth/logout'), record('/auth/login'))

    await client.POST('/api/v1/auth/refresh')
    await client.POST('/api/v1/auth/logout')
    await client.POST('/api/v1/auth/login', { body: { email: 'a@example.com', password: 'x' } })

    expect(seen['/auth/refresh'].get('X-Requested-With')).toBe(REQUESTED_WITH)
    expect(seen['/auth/logout'].get('X-Requested-With')).toBe(REQUESTED_WITH)
    expect(seen['/auth/login'].has('X-Requested-With')).toBe(false)
  })

  it('sends the access token from the provider, and nothing without one', async () => {
    let token: string | null = null
    const withSession = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => token })
    server.use(record('/auth/login'))

    await withSession.POST('/api/v1/auth/login', { body: { email: 'a@example.com', password: 'x' } })
    expect(seen['/auth/login'].has('Authorization')).toBe(false)

    token = 'abc'
    await withSession.POST('/api/v1/auth/login', { body: { email: 'a@example.com', password: 'x' } })
    expect(seen['/auth/login'].get('Authorization')).toBe('Bearer abc')
  })

  it('lets the login step plug the session into the default client', async () => {
    server.use(record('/auth/logout'))
    setAccessTokenProvider(() => 'token-da-sessao')

    await api.POST('/api/v1/auth/logout')

    expect(seen['/auth/logout'].get('Authorization')).toBe('Bearer token-da-sessao')
  })
})
