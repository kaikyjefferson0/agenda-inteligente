import { CONTENT_SECURITY_POLICY, PRODUCTION_API_ORIGIN } from '../csp.ts'
import { API, expect, SITE, test } from './support.ts'

/**
 * Items 1 and 2 of step 10: the API answers with the database, and the site
 * and the API send their security headers. GET, not HEAD: the API answers
 * HEAD with 405.
 */

const HSTS = /^max-age=(\d+)(; ?includeSubDomains)?/i

test('item 1: /health e /ready respondem, com o banco', async ({ request }) => {
  const health = await request.get(`${API}/health`)
  expect(health.status(), '/health').toBe(200)
  expect(await health.json()).toEqual({ status: 'ok' })

  // The Neon compute may be asleep (5 minutes without use): a longer wait.
  const ready = await request.get(`${API}/ready`, { timeout: 60_000 })
  expect(ready.status(), '/ready').toBe(200)
  expect(await ready.json()).toEqual({ status: 'ok', database: 'ok' })
})

for (const path of ['/', '/n/barbearia-demo', '/entrar']) {
  test(`item 2: cabeçalhos do site em ${path}`, async ({ request }) => {
    const response = await request.get(`${SITE}${path}`)
    expect(response.status()).toBe(200)
    const headers = response.headers()

    const csp = headers['content-security-policy'] ?? ''
    const directives = new Map(
      csp
        .split(';')
        .map((part) => part.trim().split(/\s+/))
        .filter((words) => words[0] !== '')
        .map(([name, ...values]) => [name, values]),
    )
    expect(directives.get('connect-src'), 'connect-src com a API').toContain(new URL(API).origin)
    expect(directives.get('frame-ancestors'), 'frame-ancestors').toEqual(["'none'"])
    expect(directives.get('script-src'), 'script-src').toEqual(["'self'"])
    // Against production, exactly the policy that the E2E tested (frontend/csp.ts).
    if (new URL(API).origin === PRODUCTION_API_ORIGIN) {
      expect(csp, 'CSP igual à de frontend/csp.ts').toBe(CONTENT_SECURITY_POLICY)
    }

    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
    expect(headers['strict-transport-security']).toMatch(HSTS)
    expect(Number(HSTS.exec(headers['strict-transport-security'] ?? '')?.[1])).toBeGreaterThanOrEqual(
      31_536_000,
    )
    // The HTML is never cached as immutable: only /assets/* is.
    expect(headers['cache-control'] ?? '').not.toContain('immutable')
  })
}

for (const path of ['/health', '/api/v1/public/businesses/barbearia-demo']) {
  test(`item 2: cabeçalhos da API em ${path}`, async ({ request }) => {
    const response = await request.get(`${API}${path}`)
    expect(response.status()).toBe(200)
    const headers = response.headers()
    expect(headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
  })
}

test('item 2: CORS da API libera só o site', async ({ request }) => {
  const allowed = await request.get(`${API}/health`, { headers: { Origin: SITE } })
  expect(allowed.headers()['access-control-allow-origin']).toBe(SITE)
  const other = await request.get(`${API}/health`, { headers: { Origin: 'https://exemplo.invalid' } })
  expect(other.headers()['access-control-allow-origin']).toBeUndefined()
})
