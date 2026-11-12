import { useEffect, useSyncExternalStore } from 'react'

import { getAppSession, type SessionState } from './session/session'

/**
 * The session state of this tab, kept in step with the others (D70). Starts
 * the silent renewal if `main.tsx` has not yet (it runs only once).
 */
export function useSession(): SessionState {
  const session = getAppSession()
  useEffect(() => {
    void session.start()
  }, [session])
  return useSyncExternalStore(session.subscribe, session.getState, session.getState)
}
