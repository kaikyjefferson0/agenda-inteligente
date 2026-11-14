import { describe, expect, it, vi } from 'vitest'

import { warmUpApi } from './warm-up'

describe('warmUpApi (D112)', () => {
  it('calls /health of the API without credentials, without reading the answer', () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null)))

    warmUpApi('https://api.example.com', fetchFn)

    expect(fetchFn).toHaveBeenCalledExactlyOnceWith('https://api.example.com/health', {
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
    })
  })

  it('does nothing with the API on the same origin', () => {
    const fetchFn = vi.fn<typeof fetch>()

    warmUpApi('', fetchFn)

    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('swallows a failure: the API may still be asleep', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')))

    expect(() => warmUpApi('https://api.example.com', fetchFn)).not.toThrow()
    await Promise.resolve()
  })

  it('uses VITE_API_BASE_URL by default', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null))
    try {
      warmUpApi()
      expect(fetchSpy).toHaveBeenCalledWith('http://api.test/health', expect.objectContaining({ mode: 'no-cors' }))
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
