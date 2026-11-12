import { api, setAccessTokenProvider, setUnauthorizedHandler, unwrap } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'

import { storageHint, type SessionHint } from './session-hint'
import {
  browserChannel,
  browserLock,
  type EndReason,
  type SessionMessage,
  type SharedSession,
  type TabChannel,
  type TabLock,
} from './tab-sync'

/**
 * Session of the panel (UC02, D70 to D72).
 *
 * - The access token lives only in memory. A reload renews it with the refresh
 *   cookie (`/auth/refresh`), once, in silence, if the hint says there may be
 *   a session (D71).
 * - Every renewal runs inside a lock shared by the tabs. Inside it, a tab first
 *   rereads what another tab obtained (a message received while it waited, or
 *   an answer to "who has a token?") and only then calls `/auth/refresh`. The
 *   tab that renewed sends the result to the others before releasing the lock.
 * - A token is renewed when it is about to expire and a request needs it, and
 *   once after a `401`; there is no timer, so an idle tab spends no rotation.
 */

export type LoginBody = components['schemas']['LoginRequest']
type SessionResponse = components['schemas']['SessionResponse']

export type SessionState =
  | { status: 'unknown' }
  | { status: 'authenticated'; token: string; expiresAt: number }
  | { status: 'anonymous'; reason: EndReason | null }

/** The calls to the API, replaceable in the tests. */
export interface SessionTransport {
  login(body: LoginBody): Promise<SessionResponse>
  refresh(): Promise<SessionResponse>
  logout(): Promise<void>
}

export interface SessionOptions {
  transport?: SessionTransport
  lock?: TabLock
  channel?: TabChannel
  hint?: SessionHint
  now?: () => number
  /** How long a tab waits for another one to answer "who has a token?". */
  askTimeoutMs?: number
}

/** A token with less than this left is renewed before a request uses it. */
export const MIN_VALIDITY_MS = 60_000
export const ASK_TIMEOUT_MS = 150

export const apiTransport: SessionTransport = {
  login: (body) => unwrap(api.POST('/api/v1/auth/login', { body })),
  refresh: () => unwrap(api.POST('/api/v1/auth/refresh')),
  logout: async () => {
    await api.POST('/api/v1/auth/logout')
  },
}

function shared(message: SharedSession): SharedSession {
  return { token: message.token, expiresAt: message.expiresAt, issuedAt: message.issuedAt }
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

export function createSession(options: SessionOptions = {}) {
  const transport = options.transport ?? apiTransport
  const lock = options.lock ?? browserLock()
  const channel = options.channel ?? browserChannel()
  const hint = options.hint ?? storageHint()
  const now = options.now ?? Date.now
  const askTimeoutMs = options.askTimeoutMs ?? ASK_TIMEOUT_MS

  let state: SessionState = { status: 'unknown' }
  let current: SharedSession | null = null
  /** The last session another tab sent, for a tab that waited on the lock. */
  let lastReceived: SharedSession | null = null
  /** Tokens the API refused with a `401`: never adopted again from a peer. */
  const rejected = new Set<string>()
  let started: Promise<void> | null = null
  let renewing: Promise<string | null> | null = null
  const listeners = new Set<() => void>()
  const resetListeners = new Set<() => void>()

  function setState(next: SessionState) {
    state = next
    for (const listener of listeners) listener()
  }

  function usable(session: SharedSession | null): session is SharedSession {
    return (
      session !== null &&
      !rejected.has(session.token) &&
      session.expiresAt - now() > MIN_VALIDITY_MS
    )
  }

  function adopt(session: SharedSession) {
    current = session
    setState({ status: 'authenticated', token: session.token, expiresAt: session.expiresAt })
  }

  /** Another user may come next: the app drops its cached data. */
  function reset() {
    for (const listener of resetListeners) listener()
  }

  function endHere(reason: EndReason | null) {
    const wasAuthenticated = state.status === 'authenticated'
    current = null
    lastReceived = null
    setState({ status: 'anonymous', reason })
    if (wasAuthenticated) reset()
  }

  function fromResponse(body: SessionResponse): SharedSession {
    const at = now()
    return { token: body.access_token, expiresAt: at + body.expires_in * 1000, issuedAt: at }
  }

  channel.subscribe((message: SessionMessage) => {
    switch (message.type) {
      case 'session': {
        const session = shared(message)
        lastReceived = session
        if (current === null || session.issuedAt > current.issuedAt) {
          const wasAuthenticated = state.status === 'authenticated'
          adopt(session)
          // A login in another tab may be of another user.
          if (message.origin === 'login' && wasAuthenticated) reset()
        }
        break
      }
      case 'ask':
        if (usable(current)) channel.post({ type: 'reply', id: message.id, ...current })
        break
      case 'ended':
        if (state.status !== 'anonymous') endHere(message.reason)
        break
      case 'reply':
        // Read by `askPeers`.
        break
    }
  })

  /** "Who has a valid token?": the first usable answer, or `null` after the wait. */
  function askPeers(): Promise<SharedSession | null> {
    return new Promise((resolve) => {
      const id = newId()
      let done = false
      const finish = (session: SharedSession | null) => {
        if (done) return
        done = true
        window.clearTimeout(timer)
        unsubscribe()
        resolve(session)
      }
      const unsubscribe = channel.subscribe((message) => {
        if ((message.type === 'reply' && message.id === id) || message.type === 'session') {
          const session = shared(message)
          if (usable(session)) finish(session)
        }
      })
      const timer = window.setTimeout(() => finish(null), askTimeoutMs)
      channel.post({ type: 'ask', id })
    })
  }

  /**
   * Renews the session once for every caller of this tab, in series with the
   * other tabs. Resolves with the token, or `null` when the refresh cookie is
   * no longer valid (the session then ends in every tab). A network failure or
   * a `5xx` is thrown, and the session stays as it was.
   */
  function renew(): Promise<string | null> {
    if (renewing !== null) return renewing
    const requestedAt = now()
    renewing = lock
      .run(async () => {
        if (usable(lastReceived) && lastReceived.issuedAt >= requestedAt) {
          adopt(lastReceived)
          return lastReceived.token
        }
        if (usable(current) && current.issuedAt >= requestedAt) return current.token

        const peer = await askPeers()
        if (peer !== null) {
          adopt(peer)
          return peer.token
        }

        try {
          const session = fromResponse(await transport.refresh())
          adopt(session)
          hint.set()
          channel.post({ type: 'session', origin: 'refresh', ...session })
          return session.token
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            end('expired')
            return null
          }
          throw error
        }
      })
      .finally(() => {
        renewing = null
      })
    return renewing
  }

  /** Ends the session here and in the other tabs, without calling the API. */
  function end(reason: EndReason) {
    hint.clear()
    channel.post({ type: 'ended', reason })
    endHere(reason)
  }

  /** The silent renewal on opening the site; runs once. */
  function start(): Promise<void> {
    started ??= (async () => {
      if (!hint.get()) {
        if (state.status === 'unknown') setState({ status: 'anonymous', reason: null })
        return
      }
      try {
        await renew()
      } catch {
        // Offline or API down: the hint stays, so a reload tries again.
        if (state.status === 'unknown') setState({ status: 'anonymous', reason: null })
      }
    })()
    return started
  }

  return {
    getState: (): SessionState => state,

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Called on login and when a session ends: the app clears its cache. */
    onReset(listener: () => void): () => void {
      resetListeners.add(listener)
      return () => resetListeners.delete(listener)
    },

    start,

    /** For the API client: a token with time left, renewing it first if needed. */
    async getAccessToken(): Promise<string | null> {
      if (state.status === 'unknown') await start()
      if (usable(current)) return current.token
      if (state.status !== 'authenticated') return null
      try {
        return await renew()
      } catch {
        // Offline: sends what it has; the API answers if it expired. `current`
        // may have changed while the renewal ran, hence the widened type.
        return (current as SharedSession | null)?.token ?? null
      }
    },

    /** After a `401` on a request with a token: one renewal (D72). */
    async handleUnauthorized(): Promise<string | null> {
      if (current !== null) rejected.add(current.token)
      current = null
      if (state.status !== 'authenticated') return null
      try {
        return await renew()
      } catch {
        return null
      }
    },

    async login(body: LoginBody): Promise<void> {
      await lock.run(async () => {
        const session = fromResponse(await transport.login(body))
        adopt(session)
        hint.set()
        channel.post({ type: 'session', origin: 'login', ...session })
      })
      reset()
    },

    /** Revokes the session in the API and ends it in every tab. */
    async logout(): Promise<void> {
      await lock.run(async () => {
        try {
          await transport.logout()
        } catch {
          // The session ends here anyway; the cookie expires on its own.
        }
      })
      end('logout')
    },

    end,
  }
}

export type Session = ReturnType<typeof createSession>

let appSession: Session | null = null

function connect(session: Session): Session {
  setAccessTokenProvider(() => session.getAccessToken())
  setUnauthorizedHandler(() => session.handleUnauthorized())
  return session
}

/** The session of the application, plugged into the API client on first use. */
export function getAppSession(): Session {
  appSession ??= connect(createSession())
  return appSession
}

/** Tests: a fresh session (memory lock, channel and hint), plugged into the client. */
export function replaceAppSession(options: SessionOptions): Session {
  appSession = connect(createSession(options))
  return appSession
}
