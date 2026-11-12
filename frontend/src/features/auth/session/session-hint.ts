/**
 * A hint that this browser may have a session (D71): only a flag, never the
 * token. Without it, the silent refresh on opening the site is skipped, so a
 * visitor of the public pages never gets a `401` from `/auth/refresh` (which
 * the browser prints as an error in the console). Losing the hint only costs a
 * new login.
 */
export interface SessionHint {
  get(): boolean
  set(): void
  clear(): void
}

export const HINT_KEY = 'agenda-inteligente:tem-sessao'

/** In `localStorage`, shared by the tabs; private windows may refuse it. */
export function storageHint(key: string = HINT_KEY): SessionHint {
  return {
    get() {
      try {
        return window.localStorage.getItem(key) === '1'
      } catch {
        return false
      }
    },
    set() {
      try {
        window.localStorage.setItem(key, '1')
      } catch {
        // Without storage, the next visit just asks for a new login.
      }
    },
    clear() {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Nothing to clear.
      }
    },
  }
}

/** For the tests: a hint shared by the managers that receive it. */
export function memoryHint(initial = false): SessionHint {
  let value = initial
  return {
    get: () => value,
    set: () => {
      value = true
    },
    clear: () => {
      value = false
    },
  }
}
