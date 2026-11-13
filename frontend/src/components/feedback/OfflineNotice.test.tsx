import { onlineManager } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { Providers } from '@/app/providers'
import { routes } from '@/app/router'
import { configApi } from '@/test/msw/configuration'
import { API } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'
import { renderPanel } from '@/test/panel'

const goOffline = () => act(() => void window.dispatchEvent(new Event('offline')))
const goOnline = () => act(() => void window.dispatchEvent(new Event('online')))

const strip = () => screen.queryByText('Sem conexão.')

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('the strip of "sem conexão" (D99)', () => {
  it('shows over a page of the panel without hiding what was loaded, and leaves when the network returns', async () => {
    await renderPanel('/painel/equipe', 'owner', 'Equipe')
    const list = await screen.findByRole('listitem', { name: 'Bruno Lima' })
    expect(strip()).not.toBeInTheDocument()

    goOffline()
    const notice = strip()!.closest('[role="status"]')!
    expect(notice).toHaveTextContent('O que já carregou continua na tela')
    expect(list).toBeInTheDocument()

    goOnline()
    expect(strip()).not.toBeInTheDocument()
    // Screen readers hear the return, in the same live region.
    expect(within(notice as HTMLElement).getByText('Conexão restabelecida.')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Bruno Lima' })).toBeInTheDocument()
  })

  it('shows on the public pages too', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(
      <Providers queryClient={createQueryClient({ queries: { retry: false } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await screen.findByRole('heading', { level: 1 }, { timeout: 10_000 })
    goOffline()
    expect(strip()).toBeInTheDocument()
    goOnline()
    expect(strip()).not.toBeInTheDocument()
  })

  it('fails a change at once without a network, and never sends it by itself later', async () => {
    let calls = 0
    server.use(
      http.post(`${API}/professionals/me`, () => {
        calls += 1
        return HttpResponse.error()
      }),
    )
    // Without a record of the Owner, the page offers "Também atendo".
    configApi.team = configApi.members().filter((member) => member.name !== 'Dona Ana')
    const { user } = await renderPanel('/painel/equipe', 'owner', 'Equipe')
    const serve = await screen.findByRole('button', { name: 'Também atendo' })

    goOffline()
    await user.click(serve)
    expect(await screen.findByText('Não foi possível passar a atender')).toBeInTheDocument()
    expect(screen.getByText(/Verifique sua internet e tente de novo/)).toBeInTheDocument()
    expect(calls).toBe(1)

    goOnline()
    // Nothing waits in a queue: the network back does not send it again.
    await waitFor(() => expect(strip()).not.toBeInTheDocument())
    expect(calls).toBe(1)
  })
})
