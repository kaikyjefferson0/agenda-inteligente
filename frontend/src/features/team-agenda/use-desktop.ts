import { useSyncExternalStore } from 'react'

/** From 1024 px the agenda has the time grid and the week (D80). */
export const DESKTOP_QUERY = '(min-width: 1024px)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const getSnapshot = () => window.matchMedia(DESKTOP_QUERY).matches

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
