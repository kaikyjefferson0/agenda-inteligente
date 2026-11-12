/**
 * What the tabs of the same origin share to renew the session once (D70).
 *
 * - The lock (Web Locks API) puts `/auth/refresh` in series across tabs: the
 *   refresh rotates without tolerance, and two calls with the same cookie are
 *   taken as reuse, which ends the session.
 * - The channel (BroadcastChannel) carries the result of the tab that renewed,
 *   so the others reread it instead of calling the refresh again. It is of the
 *   same origin and stores nothing.
 *
 * Both are interfaces, so the tests run two "tabs" in the same process.
 */

/** A session as the tabs share it. Instants are epoch milliseconds. */
export interface SharedSession {
  token: string
  expiresAt: number
  issuedAt: number
}

export type SessionMessage =
  /** A new session: after a refresh (`refresh`) or a login (`login`). */
  | ({ type: 'session'; origin: 'refresh' | 'login' } & SharedSession)
  /** A tab without a token asks whether another one has a valid session. */
  | { type: 'ask'; id: string }
  | ({ type: 'reply'; id: string } & SharedSession)
  /** The session is over in every tab. */
  | { type: 'ended'; reason: EndReason }

/** Why a session ended: the login page explains it, except after `logout`. */
export type EndReason = 'logout' | 'expired' | 'password-reset'

export interface TabLock {
  /** Runs `task` while no other tab of the origin holds the same lock. */
  run<T>(task: () => Promise<T>): Promise<T>
}

export interface TabChannel {
  post(message: SessionMessage): void
  subscribe(listener: (message: SessionMessage) => void): () => void
}

export const LOCK_NAME = 'agenda-inteligente:refresh'
export const CHANNEL_NAME = 'agenda-inteligente:sessao'

/** Serializes the tasks of this tab only: the fallback without Web Locks. */
export function localLock(): TabLock {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task)
      tail = result.catch(() => undefined)
      return result
    },
  }
}

/**
 * The Web Locks API, available in a secure context (HTTPS or localhost). On a
 * plain `http://` address of the local network it does not exist, and only the
 * tasks of the same tab are serialized (a known limitation, D70).
 */
export function browserLock(name: string = LOCK_NAME): TabLock {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (locks === undefined) return localLock()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return locks.request(name, task) as Promise<T>
    },
  }
}

/** A channel that reaches nobody, when BroadcastChannel is missing. */
export function silentChannel(): TabChannel {
  return { post() {}, subscribe: () => () => {} }
}

export function browserChannel(name: string = CHANNEL_NAME): TabChannel {
  if (typeof BroadcastChannel === 'undefined') return silentChannel()
  const channel = new BroadcastChannel(name)
  return {
    post(message) {
      channel.postMessage(message)
    },
    subscribe(listener) {
      const onMessage = (event: MessageEvent<SessionMessage>) => listener(event.data)
      channel.addEventListener('message', onMessage)
      return () => channel.removeEventListener('message', onMessage)
    },
  }
}
