import { afterEach, describe, expect, it, vi } from 'vitest'

import { storageHint } from './session-hint'
import { browserChannel, browserLock, localLock, silentChannel, type SessionMessage } from './tab-sync'

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('localLock', () => {
  it('runs the tasks one after the other, even after a failure', async () => {
    const lock = localLock()
    const order: string[] = []
    const slow = lock.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      order.push('primeira')
      throw new Error('falhou')
    })
    const next = lock.run(async () => {
      order.push('segunda')
      return 2
    })

    await expect(slow).rejects.toThrow('falhou')
    await expect(next).resolves.toBe(2)
    expect(order).toEqual(['primeira', 'segunda'])
  })
})

describe('browserLock', () => {
  it('uses the Web Locks API with the name of the session', async () => {
    const request = vi.fn((_name: string, task: () => Promise<unknown>) => task())
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })

    await expect(browserLock().run(async () => 'ok')).resolves.toBe('ok')
    expect(request).toHaveBeenCalledWith('agenda-inteligente:refresh', expect.any(Function))
  })

  it('falls back to this tab only without it (plain http on the local network)', async () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined })

    await expect(browserLock().run(async () => 'ok')).resolves.toBe('ok')
  })
})

describe('browserChannel', () => {
  it('delivers to the other channels of the same name, not to the sender', async () => {
    class FakeChannel extends EventTarget {
      static all: FakeChannel[] = []
      readonly name: string
      constructor(name: string) {
        super()
        this.name = name
        FakeChannel.all.push(this)
      }
      postMessage(data: unknown) {
        for (const other of FakeChannel.all) {
          if (other !== this && other.name === this.name) {
            other.dispatchEvent(new MessageEvent('message', { data }))
          }
        }
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel)
    const sender = browserChannel()
    const receiver = browserChannel()
    const own = vi.fn()
    const received = vi.fn()
    sender.subscribe(own)
    const leave = receiver.subscribe(received)
    const message: SessionMessage = { type: 'ended', reason: 'logout' }

    sender.post(message)
    leave()
    sender.post(message)

    expect(received).toHaveBeenCalledTimes(1)
    expect(received).toHaveBeenCalledWith(message)
    expect(own).not.toHaveBeenCalled()
  })

  it('reaches nobody without BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const channel = browserChannel()
    const listener = vi.fn()
    channel.subscribe(listener)()
    channel.post({ type: 'ended', reason: 'logout' })

    expect(listener).not.toHaveBeenCalled()
    expect(() => silentChannel().post({ type: 'ask', id: '1' })).not.toThrow()
  })
})

describe('storageHint (D71)', () => {
  it('stores a flag, never the token', () => {
    const hint = storageHint()
    expect(hint.get()).toBe(false)

    hint.set()
    expect(window.localStorage.getItem('agenda-inteligente:tem-sessao')).toBe('1')
    expect(hint.get()).toBe(true)

    hint.clear()
    expect(hint.get()).toBe(false)
  })

  it('works as "no session" when the storage refuses access', () => {
    const refuse = () => {
      throw new DOMException('negado', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse)
    const hint = storageHint()

    expect(() => hint.set()).not.toThrow()
    expect(() => hint.clear()).not.toThrow()
    expect(hint.get()).toBe(false)
    vi.restoreAllMocks()
  })
})
