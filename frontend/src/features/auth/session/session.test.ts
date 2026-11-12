import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, setAccessTokenProvider, setUnauthorizedHandler } from '@/api/client'
import { authApi } from '@/test/msw/auth'
import { API, problem } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'
import { memoryBus } from '@/test/session'

import { memoryHint, type SessionHint } from './session-hint'
import { createSession, getAppSession, MIN_VALIDITY_MS, replaceAppSession, type SessionOptions } from './session'
import { localLock, silentChannel, type TabLock } from './tab-sync'

/** Several tabs of one browser: one lock, one channel and one hint (localStorage). */
function browser({ hint = memoryHint(true), now }: { hint?: SessionHint; now?: () => number } = {}) {
  const lock: TabLock = localLock()
  const channel = memoryBus()
  return {
    hint,
    tab(options: SessionOptions = {}) {
      return createSession({ lock, channel: channel(), hint, now, askTimeoutMs: 200, ...options })
    },
  }
}

afterEach(() => {
  setAccessTokenProvider(() => null)
  setUnauthorizedHandler(() => Promise.resolve(null))
})

describe('silent renewal on opening (UC02, D71)', () => {
  it('renews once with the hint and keeps the token only in memory', async () => {
    authApi.signIn()
    const tab = browser().tab()

    await tab.start()
    await tab.start()

    expect(authApi.calls.refresh).toBe(1)
    expect(tab.getState()).toMatchObject({ status: 'authenticated', token: 'acesso-1' })
    expect(window.localStorage.length).toBe(0)
  })

  it('does not call the refresh without the hint', async () => {
    const tab = browser({ hint: memoryHint(false) }).tab()

    await tab.start()

    expect(authApi.calls.refresh).toBe(0)
    expect(tab.getState()).toEqual({ status: 'anonymous', reason: null })
  })

  it('ends the session and clears the hint when the cookie is no longer valid', async () => {
    const { hint, tab } = browser()
    const session = tab()

    await session.start()

    expect(session.getState()).toEqual({ status: 'anonymous', reason: 'expired' })
    expect(hint.get()).toBe(false)
  })

  it('keeps the hint when the API cannot be reached, so a reload tries again', async () => {
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.error()))
    const { hint, tab } = browser()
    const session = tab()

    await session.start()

    expect(session.getState()).toEqual({ status: 'anonymous', reason: null })
    expect(hint.get()).toBe(true)
  })
})

describe('one renewal across tabs (D70)', () => {
  it('two tabs opening at the same time call /auth/refresh once', async () => {
    authApi.signIn()
    authApi.refreshDelayMs = 30
    const { tab } = browser()
    const first = tab()
    const second = tab()

    await Promise.all([first.start(), second.start()])

    expect(authApi.calls.refresh).toBe(1)
    expect(first.getState()).toMatchObject({ status: 'authenticated', token: 'acesso-1' })
    expect(second.getState()).toMatchObject({ status: 'authenticated', token: 'acesso-1' })
  })

  it('three tabs renewing a token about to expire call /auth/refresh once', async () => {
    authApi.signIn()
    let clock = 1_000_000
    const { tab } = browser({ now: () => clock })
    const tabs = [tab(), tab(), tab()]
    await Promise.all(tabs.map((each) => each.start()))
    expect(authApi.calls.refresh).toBe(1)

    clock += 900_000 - MIN_VALIDITY_MS + 1
    const tokens = await Promise.all(tabs.map((each) => each.getAccessToken()))

    expect(authApi.calls.refresh).toBe(2)
    expect(tokens).toEqual(['acesso-2', 'acesso-2', 'acesso-2'])
  })

  it('a new tab takes the token of an open one without calling the refresh', async () => {
    authApi.signIn()
    const { tab } = browser()
    const open = tab()
    await open.start()

    const opened = tab()
    await opened.start()

    expect(authApi.calls.refresh).toBe(1)
    expect(opened.getState()).toMatchObject({ status: 'authenticated', token: 'acesso-1' })
  })

  it('renews once for concurrent requests of the same tab', async () => {
    authApi.signIn()
    const session = browser().tab()

    const tokens = await Promise.all([
      session.getAccessToken(),
      session.getAccessToken(),
      session.getAccessToken(),
    ])

    expect(tokens).toEqual(['acesso-1', 'acesso-1', 'acesso-1'])
    expect(authApi.calls.refresh).toBe(1)
  })

  it('works without a peer to ask (a single tab, or no BroadcastChannel)', async () => {
    authApi.signIn()
    const session = createSession({ lock: localLock(), channel: silentChannel(), hint: memoryHint(true), askTimeoutMs: 1 })

    expect(await session.getAccessToken()).toBe('acesso-1')
  })

  it('sends the old token when the renewal fails on the network', async () => {
    authApi.signIn()
    let clock = 1_000_000
    const session = browser({ now: () => clock }).tab()
    await session.start()
    server.use(http.post(`${API}/auth/refresh`, () => HttpResponse.error()))

    clock += 900_000 - MIN_VALIDITY_MS + 1

    expect(await session.getAccessToken()).toBe('acesso-1')
    expect(session.getState().status).toBe('authenticated')
  })
})

describe('login and logout across tabs', () => {
  it('a login reaches the other tabs and resets their data', async () => {
    const { tab, hint } = browser({ hint: memoryHint(false) })
    const here = tab()
    const there = tab()
    await Promise.all([here.start(), there.start()])
    const reset = vi.fn()
    here.onReset(reset)

    await here.login({ email: 'dono@exemplo.com', password: 'uma senha longa de teste' })
    await vi.waitFor(() => expect(there.getState()).toMatchObject({ status: 'authenticated' }))

    expect(here.getState()).toMatchObject({ status: 'authenticated', token: 'acesso-1' })
    expect(reset).toHaveBeenCalledTimes(1)
    expect(hint.get()).toBe(true)
  })

  it('a login in another tab replaces the session of this one, maybe of another user', async () => {
    authApi.signIn()
    const { tab } = browser()
    const here = tab()
    await here.start()
    const reset = vi.fn()
    here.onReset(reset)

    await tab().login({ email: 'profissional@exemplo.com', password: 'uma senha longa de teste' })

    await vi.waitFor(() => expect(here.getState()).toMatchObject({ token: 'acesso-2' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('logout revokes in the API and ends the session in every tab', async () => {
    authApi.signIn()
    const { tab, hint } = browser()
    const here = tab()
    const there = tab()
    await Promise.all([here.start(), there.start()])
    const reset = vi.fn()
    there.onReset(reset)

    await here.logout()
    await vi.waitFor(() => expect(there.getState()).toEqual({ status: 'anonymous', reason: 'logout' }))

    expect(authApi.calls.logout).toBe(1)
    expect(here.getState()).toEqual({ status: 'anonymous', reason: 'logout' })
    expect(hint.get()).toBe(false)
    expect(reset).toHaveBeenCalledTimes(1)
    expect(await here.getAccessToken()).toBeNull()
  })

  it('ends the session here even when the logout fails on the network', async () => {
    authApi.signIn()
    const session = browser().tab()
    await session.start()
    server.use(http.post(`${API}/auth/logout`, () => HttpResponse.error()))

    await session.logout()

    expect(session.getState()).toEqual({ status: 'anonymous', reason: 'logout' })
  })

  it('a failed renewal in one tab ends the others', async () => {
    authApi.signIn()
    let clock = 1_000_000
    const { tab } = browser({ now: () => clock })
    const here = tab()
    const there = tab()
    await Promise.all([here.start(), there.start()])
    authApi.cookie = false

    clock += 900_000
    expect(await here.getAccessToken()).toBeNull()

    await vi.waitFor(() => expect(there.getState()).toEqual({ status: 'anonymous', reason: 'expired' }))
  })
})

describe('401 on a request with a token (D72)', () => {
  it('renews once and never takes back the refused token from a peer', async () => {
    authApi.signIn()
    const { tab } = browser()
    const here = tab()
    const there = tab()
    await Promise.all([here.start(), there.start()])
    expect(authApi.calls.refresh).toBe(1)

    // The other tab still holds the refused token and would answer with it.
    const token = await here.handleUnauthorized()

    expect(token).toBe('acesso-2')
    expect(authApi.calls.refresh).toBe(2)
  })

  it('answers null without a session, or when the renewal fails', async () => {
    const session = browser({ hint: memoryHint(false) }).tab()
    await session.start()
    expect(await session.handleUnauthorized()).toBeNull()

    authApi.signIn()
    const other = browser().tab()
    await other.start()
    server.use(http.post(`${API}/auth/refresh`, () => problem(503, 'DATABASE_UNAVAILABLE')))
    expect(await other.handleUnauthorized()).toBeNull()
  })

  it('is plugged into the API client by the app session', async () => {
    authApi.signIn()
    const session = replaceAppSession({ lock: localLock(), channel: silentChannel(), hint: memoryHint(true), askTimeoutMs: 1 })
    expect(getAppSession()).toBe(session)

    const { data } = await api.GET('/api/v1/auth/me')
    expect(data?.user.role).toBe('owner')

    // The session was revoked elsewhere (password reset): the token is refused,
    // the refresh cookie too, and the session ends.
    authApi.tokens.clear()
    authApi.cookie = false
    await expect(api.GET('/api/v1/auth/me')).rejects.toMatchObject({ status: 401 })
    expect(session.getState()).toEqual({ status: 'anonymous', reason: 'expired' })
  })
})

describe('end without the API', () => {
  it('ends every tab after a password reset', async () => {
    authApi.signIn()
    const { tab, hint } = browser()
    const here = tab()
    const there = tab()
    await Promise.all([here.start(), there.start()])

    here.end('password-reset')

    await vi.waitFor(() =>
      expect(there.getState()).toEqual({ status: 'anonymous', reason: 'password-reset' }),
    )
    expect(hint.get()).toBe(false)
  })

  it('stops notifying a listener that left', async () => {
    authApi.signIn()
    const session = browser().tab()
    const listener = vi.fn()
    const leave = session.subscribe(listener)
    leave()

    await session.start()

    expect(listener).not.toHaveBeenCalled()
  })
})
