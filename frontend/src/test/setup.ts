import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'

import { server } from './msw/server'

// The default wait of findBy… and waitFor. The 1 s of the Testing Library is short for the
// first drawing of a page whose group of routes is loaded on demand (D54) while the whole suite
// shares the machine, as in the CI: measured with coverage, such waits reached 2 s here, and
// the CI was much slower than this machine at its peaks. Only the first opening of the panel in
// a file waits longer, on its own.
configure({ asyncUtilTimeout: 5_000 })

// jsdom has no matchMedia; the sidebar and the color scheme use it.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// jsdom has no ResizeObserver; the radio group of Radix measures its items with it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: ResizeObserverStub,
})

// jsdom has no pointer capture nor scrollIntoView; the Select of Radix uses them.
for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'] as const) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      writable: true,
      value: name === 'hasPointerCapture' ? () => false : () => {},
    })
  }
}

// Any request without a handler fails the test instead of reaching the network.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => server.close())

// Each test starts with no session: a fresh one with memory lock, channel and hint.
// The demo accounts (D75) are on in the tests, and some turn them off.
beforeEach(async () => {
  const { replaceAppSession } = await import('@/features/auth')
  const { localLock, silentChannel } = await import('@/features/auth/session/tab-sync')
  const { memoryHint } = await import('@/features/auth/session/session-hint')
  const { authApi } = await import('./msw/auth')
  const { teamApi } = await import('./msw/team-agenda')
  const { scheduleApi } = await import('./msw/work-schedule')
  const { configApi } = await import('./msw/configuration')
  authApi.reset()
  teamApi.reset()
  scheduleApi.reset()
  configApi.reset()
  replaceAppSession({ lock: localLock(), channel: silentChannel(), hint: memoryHint(), askTimeoutMs: 5 })
})
