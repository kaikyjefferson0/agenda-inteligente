import { localLock, type SessionMessage, type TabChannel } from '@/features/auth/session/tab-sync'

/**
 * Several "tabs" in one process (D70): a channel that delivers to the others,
 * never to the sender, asynchronously and as a copy, like BroadcastChannel.
 */
export function memoryBus() {
  const members = new Set<(message: SessionMessage) => void>()
  return function channel(): TabChannel {
    const own = new Set<(message: SessionMessage) => void>()
    return {
      post(message) {
        for (const listener of [...members]) {
          if (own.has(listener)) continue
          setTimeout(() => listener(structuredClone(message)), 0)
        }
      },
      subscribe(listener) {
        own.add(listener)
        members.add(listener)
        return () => {
          own.delete(listener)
          members.delete(listener)
        }
      },
    }
  }
}

/** One lock shared by the "tabs", as the Web Locks API is by the origin. */
export const sharedLock = localLock

/**
 * The browser already has a session (the refresh cookie and the hint): the
 * app renews it in silence on opening, as after a reload.
 */
export async function withOpenSession(role: 'owner' | 'professional' = 'owner') {
  const { replaceAppSession } = await import('@/features/auth')
  const { silentChannel } = await import('@/features/auth/session/tab-sync')
  const { memoryHint } = await import('@/features/auth/session/session-hint')
  const { authApi } = await import('./msw/auth')
  authApi.signIn(role)
  const hint = memoryHint(true)
  const session = replaceAppSession({ lock: localLock(), channel: silentChannel(), hint, askTimeoutMs: 5 })
  return { session, hint }
}
