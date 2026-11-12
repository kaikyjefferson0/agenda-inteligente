import { delay, http, HttpResponse } from 'msw'

import type { components } from '@/api/schema'

import { API, problem } from './handlers'

type Me = components['schemas']['MeResponse']
type Role = components['schemas']['UserRole']

export const TEST_PASSWORD = 'uma senha longa de teste'
export const OWNER_EMAIL = 'dono@exemplo.com'
export const PROFESSIONAL_EMAIL = 'profissional@exemplo.com'
export const VALID_TOKEN = 'token-valido'

export function meOf(role: Role = 'owner'): Me {
  return {
    user: {
      id: '7e1f0b6c-0000-4000-8000-000000000001',
      name: role === 'owner' ? 'Dona Ana' : 'Bruno Lima',
      email: role === 'owner' ? OWNER_EMAIL : PROFESSIONAL_EMAIL,
      role,
    },
    business: {
      id: '7e1f0b6c-0000-4000-8000-000000000002',
      name: 'Barbearia Central',
      slug: 'barbearia-central',
      timezone: 'America/Sao_Paulo',
      is_demo: false,
    },
  }
}

/**
 * A small auth API with state: the "cookie" is whether a session is open, and
 * each access token is numbered. Counters let the tests check how many times
 * `/auth/refresh` was called (D70).
 */
export const authApi = {
  cookie: false,
  role: 'owner' as Role,
  issued: 0,
  tokens: new Set<string>(),
  calls: { login: 0, refresh: 0, logout: 0, me: 0, forgot: 0, reset: 0, accept: 0 },
  /** Wait before answering the refresh, so two tabs overlap. */
  refreshDelayMs: 0,
  bodies: [] as unknown[],

  reset() {
    this.cookie = false
    this.role = 'owner'
    this.issued = 0
    this.tokens.clear()
    this.refreshDelayMs = 0
    this.bodies = []
    for (const key of Object.keys(this.calls) as (keyof typeof this.calls)[]) this.calls[key] = 0
  },

  /** A session already open in this browser (the refresh cookie is there). */
  signIn(role: Role = 'owner') {
    this.cookie = true
    this.role = role
  },

  issue() {
    this.issued += 1
    const token = `acesso-${this.issued}`
    this.tokens.add(token)
    return HttpResponse.json(
      { access_token: token, token_type: 'bearer', expires_in: 900 },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  },
}

export const authHandlers = [
  http.post(`${API}/auth/login`, async ({ request }) => {
    authApi.calls.login += 1
    const body = (await request.json()) as { email: string; password: string }
    authApi.bodies.push(body)
    const known: Record<string, Role> = {
      [OWNER_EMAIL]: 'owner',
      [PROFESSIONAL_EMAIL]: 'professional',
      'dono@demo.example.com': 'owner',
      'profissional@demo.example.com': 'professional',
    }
    const password = body.email.endsWith('@demo.example.com')
      ? import.meta.env.VITE_DEMO_PASSWORD
      : TEST_PASSWORD
    const role = known[body.email]
    if (role === undefined || body.password !== password) return problem(401, 'INVALID_CREDENTIALS')
    authApi.cookie = true
    authApi.role = role
    return authApi.issue()
  }),
  http.post(`${API}/auth/refresh`, async ({ request }) => {
    authApi.calls.refresh += 1
    if (request.headers.get('X-Requested-With') === null) return problem(403, 'FORBIDDEN')
    if (authApi.refreshDelayMs > 0) await delay(authApi.refreshDelayMs)
    if (!authApi.cookie) return problem(401, 'INVALID_REFRESH_TOKEN')
    return authApi.issue()
  }),
  http.post(`${API}/auth/logout`, () => {
    authApi.calls.logout += 1
    authApi.cookie = false
    authApi.tokens.clear()
    return new HttpResponse(null, { status: 204 })
  }),
  http.get(`${API}/auth/me`, ({ request }) => {
    authApi.calls.me += 1
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!authApi.tokens.has(token)) return problem(401, 'NOT_AUTHENTICATED')
    return HttpResponse.json(meOf(authApi.role))
  }),
  http.post(`${API}/auth/password/forgot`, async ({ request }) => {
    authApi.calls.forgot += 1
    authApi.bodies.push(await request.json())
    return new HttpResponse(null, { status: 202 })
  }),
  http.post(`${API}/auth/password/reset`, async ({ request }) => {
    authApi.calls.reset += 1
    const body = (await request.json()) as { token: string }
    authApi.bodies.push(body)
    if (body.token !== VALID_TOKEN) return problem(400, 'INVALID_TOKEN')
    authApi.cookie = false
    authApi.tokens.clear()
    return new HttpResponse(null, { status: 204 })
  }),
  http.post(`${API}/auth/invitations/accept`, async ({ request }) => {
    authApi.calls.accept += 1
    const body = (await request.json()) as { token: string }
    authApi.bodies.push(body)
    if (body.token !== VALID_TOKEN) return problem(400, 'INVALID_TOKEN')
    return new HttpResponse(null, { status: 204 })
  }),
]
