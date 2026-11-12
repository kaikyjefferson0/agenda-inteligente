import type { KeyboardEvent } from 'react'

const STEP_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

/** Arrow keys, Home and End over a radio group, wrapping around. */
export function targetIndex(event: KeyboardEvent, index: number, count: number): number | null {
  if (event.key === 'Home') return 0
  if (event.key === 'End') return count - 1
  const delta = STEP_KEYS[event.key]
  if (delta === undefined) return null
  return (index + delta + count) % count
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}
