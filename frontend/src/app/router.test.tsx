import { render, screen } from '@testing-library/react'
import { createMemoryRouter, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it, vi } from 'vitest'

import { Providers } from './providers'
import { PATHS, routes } from './router'

function renderAt(path: string, routeObjects: RouteObject[] = routes) {
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] })
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

describe('router (D54)', () => {
  it('renders the home page at /', async () => {
    renderAt(PATHS.home)

    expect(
      await screen.findByRole('heading', { level: 1, name: /agendamento online/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver a demo/i })).toHaveAttribute(
      'href',
      '/n/barbearia-demo',
    )
    expect(screen.getByRole('link', { name: /entrar no painel/i })).toHaveAttribute(
      'href',
      '/entrar',
    )
  })

  it('shows the 404 page for an unknown path', async () => {
    renderAt('/nao-existe/de-jeito-nenhum')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeInTheDocument()
  })

  it.each([
    [PATHS.customerAppointment('abc'), 'Seu agendamento'],
    [PATHS.invitation('abc'), 'Aceitar convite'],
    [PATHS.resetPassword('abc'), 'Definir nova senha'],
    [PATHS.business('barbearia-demo'), 'Página do negócio'],
    [PATHS.login, 'Entrar'],
    [PATHS.forgotPassword, 'Esqueci minha senha'],
  ])('has the page %s', async (path, title) => {
    renderAt(path)

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  })

  it('keeps the token out of the Referer on pages opened from a link', async () => {
    renderAt(PATHS.customerAppointment('abc'))

    await screen.findByRole('heading', { level: 1, name: 'Seu agendamento' })
    expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute(
      'content',
      'no-referrer',
    )
  })

  it.each([
    [PATHS.panel, 'Agenda'],
    ['/painel/servicos', 'Serviços'],
    ['/painel/equipe', 'Equipe'],
    ['/painel/expediente', 'Expediente'],
    ['/painel/bloqueios', 'Bloqueios'],
    ['/painel/negocio', 'Negócio'],
  ])('has the panel page %s with the side menu', async (path, title) => {
    renderAt(path)

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: title })).toHaveAttribute('aria-current', 'page')
  })

  it('shows the error element of the group when a page fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing: RouteObject[] = [
      {
        path: '/',
        errorElement: routes[0].errorElement,
        Component: () => {
          throw new Error('boom')
        },
      },
    ]

    renderAt('/', failing)

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta página não pôde ser exibida')
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/')
    vi.restoreAllMocks()
  })
})
