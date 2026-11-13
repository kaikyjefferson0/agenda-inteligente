import { onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

const subscribe = (onChange: () => void) => onlineManager.subscribe(onChange)
const isOnline = () => onlineManager.isOnline()

/**
 * Whether the browser has a network, as the TanStack Query sees it (D99): the
 * same source that pauses and resumes the reads, so the notice and the
 * paused queries never disagree.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true)
}
