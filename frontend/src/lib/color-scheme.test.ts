import { describe, expect, it, vi } from 'vitest'

import { applyColorScheme, DARK_QUERY, syncColorScheme } from './color-scheme'

function fakeQuery(matches: boolean) {
  const listeners: Array<(event: MediaQueryListEvent) => void> = []
  const query = {
    matches,
    addEventListener: vi.fn((_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.push(listener)
    }),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList
  const change = (dark: boolean) =>
    listeners.forEach((listener) => listener({ matches: dark } as MediaQueryListEvent))
  return { query, change }
}

describe('color scheme (D55)', () => {
  it('toggles the dark class and color-scheme', () => {
    const root = document.createElement('html')
    applyColorScheme(true, root)
    expect(root).toHaveClass('dark')
    expect(root.style.colorScheme).toBe('dark')
    applyColorScheme(false, root)
    expect(root).not.toHaveClass('dark')
    expect(root.style.colorScheme).toBe('light')
  })

  it('follows the system preference and its changes', () => {
    const root = document.createElement('html')
    const { query, change } = fakeQuery(true)
    const matchMedia = vi.fn(() => query)

    const stop = syncColorScheme(root, matchMedia)
    expect(matchMedia).toHaveBeenCalledWith(DARK_QUERY)
    expect(root).toHaveClass('dark')

    change(false)
    expect(root).not.toHaveClass('dark')

    stop()
    expect(query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('uses the document and window by default', () => {
    const stop = syncColorScheme()
    expect(document.documentElement).not.toHaveClass('dark')
    stop()
  })
})
