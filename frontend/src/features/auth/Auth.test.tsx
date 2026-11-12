import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { Providers } from '@/app/providers'
import { PATHS, routes } from '@/app/router'
import {
  authApi,
  OWNER_EMAIL,
  PROFESSIONAL_EMAIL,
  TEST_PASSWORD,
  VALID_TOKEN,
} from '@/test/msw/auth'
import { API, problem } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'
import { withOpenSession } from '@/test/session'

import { getAppSession } from './session/session'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  render(
    <Providers queryClient={createQueryClient({ queries: { retry: false } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { router, user }
}

const where = (router: ReturnType<typeof renderAt>['router']) =>
  `${router.state.location.pathname}${router.state.location.search}`

async function fillLogin(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(await screen.findByLabelText('E-mail'), email)
  await user.type(screen.getByLabelText('Senha'), password)
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('login (UC02)', () => {
  it('opens the panel after a valid login, with the user and the business', async () => {
    const { router, user } = renderAt(PATHS.login)

    await fillLogin(user, OWNER_EMAIL, TEST_PASSWORD)

    await waitFor(() => expect(where(router)).toBe('/painel'))
    expect(await screen.findByText('Dona Ana')).toBeInTheDocument()
    expect(screen.getByText('Dono · Barbearia Central')).toBeInTheDocument()
    expect(authApi.bodies).toEqual([{ email: OWNER_EMAIL, password: TEST_PASSWORD }])
  })

  it('says the credentials are wrong without naming the field, and clears the password', async () => {
    const { user } = renderAt(PATHS.login)

    await fillLogin(user, OWNER_EMAIL, 'senha errada de alguém')

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.')
    expect(screen.getByLabelText('Senha')).toHaveValue('')
    expect(screen.getByLabelText('Senha')).toHaveFocus()
    expect(screen.getByLabelText('E-mail')).toHaveValue(OWNER_EMAIL)
  })

  it('validates the fields before sending', async () => {
    const { user } = renderAt(PATHS.login)

    await user.click(await screen.findByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Informe seu e-mail.')).toBeInTheDocument()
    expect(screen.getByText('Informe sua senha.')).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true')
    expect(authApi.calls.login).toBe(0)
  })

  it('holds the button with the wait of a 429', async () => {
    server.use(
      http.post(`${API}/auth/login`, () =>
        problem(429, 'RATE_LIMITED', {}, { 'Retry-After': '30' }),
      ),
    )
    const { user } = renderAt(PATHS.login)

    await fillLogin(user, OWNER_EMAIL, TEST_PASSWORD)

    expect(await screen.findByRole('alert')).toHaveTextContent('Tente de novo em 30 segundos.')
    expect(screen.getByRole('button', { name: 'Aguarde 30 s' })).toBeDisabled()
  })

  it('shows and hides the password, and lets the browser fill it', async () => {
    const { user } = renderAt(PATHS.login)
    const password = await screen.findByLabelText('Senha')
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')

    await user.click(screen.getByRole('button', { name: 'Mostrar senha' }))
    expect(password).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Ocultar senha' }))
    expect(password).toHaveAttribute('type', 'password')
  })

  it('goes straight to the panel when the tab already has a session', async () => {
    await withOpenSession()
    const { router } = renderAt(PATHS.login)

    await waitFor(() => expect(where(router)).toBe('/painel'))
  })

  it('explains why a session ended', async () => {
    getAppSession().end('expired')
    renderAt(PATHS.login)

    expect(await screen.findByText('Sua sessão terminou. Entre novamente para continuar.')).toBeInTheDocument()
  })
})

describe('demo access (D75)', () => {
  it('enters the demo as the Professional, with the password of the build', async () => {
    const { router, user } = renderAt(PATHS.login)

    const demo = await screen.findByRole('region', { name: 'Conhecer pela demonstração' })
    await user.click(within(demo).getByRole('button', { name: /entrar como profissional/i }))

    await waitFor(() => expect(where(router)).toBe('/painel'))
    expect(authApi.bodies).toEqual([
      { email: 'profissional@demo.example.com', password: 'senha-da-demo-de-teste' },
    ])
  })

  it('shows the error inside the demo block', async () => {
    server.use(http.post(`${API}/auth/login`, () => problem(401, 'INVALID_CREDENTIALS')))
    const { user } = renderAt(PATHS.login)

    const demo = await screen.findByRole('region', { name: 'Conhecer pela demonstração' })
    await user.click(within(demo).getByRole('button', { name: /entrar como dono/i }))

    expect(await within(demo).findByRole('alert')).toHaveTextContent('Não foi possível abrir a demonstração')
  })

  it('is hidden when the build has no demo password', async () => {
    vi.stubEnv('VITE_DEMO_PASSWORD', '')
    renderAt(PATHS.login)

    await screen.findByRole('heading', { level: 1, name: 'Entrar' })
    expect(screen.queryByRole('region', { name: 'Conhecer pela demonstração' })).not.toBeInTheDocument()
  })
})

describe('protected panel (D73, D74)', () => {
  it('sends to /entrar without a session and comes back to the page asked for', async () => {
    const { router, user } = renderAt('/painel/expediente?dia=2026-11-10')

    await waitFor(() =>
      expect(where(router)).toBe(`/entrar?voltar=${encodeURIComponent('/painel/expediente?dia=2026-11-10')}`),
    )
    await fillLogin(user, OWNER_EMAIL, TEST_PASSWORD)

    await waitFor(() => expect(where(router)).toBe('/painel/expediente?dia=2026-11-10'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Expediente' })).toBeInTheDocument()
  })

  it('never follows a return address outside the panel', async () => {
    const { router, user } = renderAt('/entrar?voltar=https%3A%2F%2Fexemplo.com')

    await fillLogin(user, OWNER_EMAIL, TEST_PASSWORD)

    await waitFor(() => expect(where(router)).toBe('/painel'))
  })

  it('hides the pages of the Owner from a Professional and sends them back', async () => {
    await withOpenSession('professional')
    const { router } = renderAt('/painel/equipe')

    await waitFor(() => expect(where(router)).toBe('/painel'))
    expect(await screen.findByText('Bruno Lima')).toBeInTheDocument()
    expect(screen.getByText('Profissional · Barbearia Central')).toBeInTheDocument()
    const menu = document.querySelector<HTMLElement>('[data-slot="sidebar"]')!
    for (const page of ['Agenda', 'Expediente', 'Bloqueios']) {
      expect(within(menu).getByRole('link', { name: page })).toBeInTheDocument()
    }
    for (const page of ['Serviços', 'Equipe', 'Negócio']) {
      expect(within(menu).queryByRole('link', { name: page })).not.toBeInTheDocument()
    }
  })

  it('logout clears the session and the cached data, and goes to /entrar', async () => {
    const { session } = await withOpenSession()
    const { router, user } = renderAt('/painel')
    await screen.findByText('Dona Ana')

    await user.click(screen.getByRole('button', { name: 'Sair' }))

    await waitFor(() => expect(where(router)).toBe('/entrar'))
    expect(authApi.calls.logout).toBe(1)
    expect(session.getState()).toEqual({ status: 'anonymous', reason: 'logout' })
    expect(await session.getAccessToken()).toBeNull()
    expect(await screen.findByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument()
    // Nothing of the previous user stays.
    expect(screen.queryByText('Dona Ana')).not.toBeInTheDocument()
  })

  it('leaves the panel with the page to return to when the session ends elsewhere', async () => {
    const { session } = await withOpenSession()
    const { router } = renderAt('/painel/bloqueios')
    await screen.findByText('Dona Ana')

    session.end('expired')

    await waitFor(() =>
      expect(where(router)).toBe(`/entrar?voltar=${encodeURIComponent('/painel/bloqueios')}`),
    )
  })
})

describe('forgot password (UC03)', () => {
  it('answers the same for any e-mail and tells to check the inbox', async () => {
    const { user } = renderAt(PATHS.forgotPassword)

    await user.type(await screen.findByLabelText('E-mail'), PROFESSIONAL_EMAIL)
    await user.click(screen.getByRole('button', { name: 'Enviar link' }))

    // Focused in a useEffect after the response: it may run after findByRole resolves.
    const sent = await screen.findByRole('heading', { level: 2, name: 'Confira seu e-mail' })
    await waitFor(() => expect(sent).toHaveFocus())
    expect(screen.getByText(PROFESSIONAL_EMAIL)).toBeInTheDocument()
    expect(authApi.bodies).toEqual([{ email: PROFESSIONAL_EMAIL }])

    await user.click(screen.getByRole('button', { name: 'Usar outro e-mail' }))
    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveFocus())
  })

  it('says the demo accounts have no recovery, without calling the API (RN28)', async () => {
    const { user } = renderAt(PATHS.forgotPassword)

    await user.type(await screen.findByLabelText('E-mail'), 'dono@demo.example.com')
    await user.click(screen.getByRole('button', { name: 'Enviar link' }))

    expect(await screen.findByText(/as contas da demonstração não recuperam senha/i)).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toHaveFocus()
    expect(authApi.calls.forgot).toBe(0)
  })

  it('holds the button in minutes after a 429 of the hourly limit', async () => {
    server.use(
      http.post(`${API}/auth/password/forgot`, () =>
        problem(429, 'RATE_LIMITED', {}, { 'Retry-After': '1800' }),
      ),
    )
    const { user } = renderAt(PATHS.forgotPassword)

    await user.type(await screen.findByLabelText('E-mail'), OWNER_EMAIL)
    await user.click(screen.getByRole('button', { name: 'Enviar link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Tente de novo em 30 minutos.')
    expect(screen.getByRole('button', { name: 'Aguarde 30 min' })).toBeDisabled()
  })
})

describe('new password: reset (UC03) and invitation (UC04), RN30', () => {
  it.each([
    ['curta', 'onze letras', 'A senha precisa ter pelo menos 12 caracteres.'],
    ['longa', 'a'.repeat(129), 'A senha pode ter no máximo 128 caracteres.'],
  ])('refuses a password too %s before sending', async (_case, password, message) => {
    const { user } = renderAt(PATHS.resetPassword(VALID_TOKEN))

    const field = await screen.findByLabelText('Nova senha')
    await user.click(field)
    await user.paste(password)
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(authApi.calls.reset).toBe(0)
  })

  it('takes any 12 characters, with no composition rule, and ends every session', async () => {
    const { session } = await withOpenSession()
    await session.start()
    const { user } = renderAt(PATHS.resetPassword(VALID_TOKEN))

    await user.type(await screen.findByLabelText('Nova senha'), 'aaaaaaaaaaaa')
    expect(screen.getByTestId('contador-senha')).toHaveTextContent('12 caracteres')
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }))

    const done = await screen.findByRole('heading', { level: 2, name: 'Senha alterada' })
    await waitFor(() => expect(done).toHaveFocus())
    expect(authApi.bodies).toEqual([{ token: VALID_TOKEN, new_password: 'aaaaaaaaaaaa' }])
    expect(session.getState()).toEqual({ status: 'anonymous', reason: 'password-reset' })
    expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  })

  it('shows a dead link and the way to ask for another', async () => {
    const { user } = renderAt(PATHS.resetPassword('vencido'))

    await user.type(await screen.findByLabelText('Nova senha'), 'uma senha nova e longa')
    await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Este link não vale mais' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pedir outro link' })).toHaveAttribute('href', '/esqueci-senha')
  })

  it('treats a token refused by its size as a dead link', async () => {
    server.use(
      http.post(`${API}/auth/invitations/accept`, () =>
        problem(422, 'VALIDATION_ERROR', {
          errors: [{ loc: ['body', 'token'], msg: 'too long', type: 'string_too_long' }],
        }),
      ),
    )
    const { user } = renderAt(PATHS.invitation('x'.repeat(600)))

    await user.type(await screen.findByLabelText('Nova senha'), 'uma senha nova e longa')
    await user.click(screen.getByRole('button', { name: 'Ativar conta' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Este convite não vale mais' })).toBeInTheDocument()
  })

  it('maps a 422 on the password to the RN30 hint', async () => {
    server.use(
      http.post(`${API}/auth/invitations/accept`, () =>
        problem(422, 'VALIDATION_ERROR', {
          errors: [{ loc: ['body', 'password'], msg: 'too short', type: 'string_too_short' }],
        }),
      ),
    )
    const { user } = renderAt(PATHS.invitation(VALID_TOKEN))

    await user.type(await screen.findByLabelText('Nova senha'), 'uma senha nova e longa')
    await user.click(screen.getByRole('button', { name: 'Ativar conta' }))

    await waitFor(() => expect(screen.getByLabelText('Nova senha')).toHaveAttribute('aria-invalid', 'true'))
  })

  it('activates the invitation and points to the login', async () => {
    const { user } = renderAt(PATHS.invitation(VALID_TOKEN))

    await user.type(await screen.findByLabelText('Nova senha'), 'minha senha de profissional')
    await user.click(screen.getByRole('button', { name: 'Ativar conta' }))

    const done = await screen.findByRole('status')
    expect(within(done).getByRole('heading', { level: 2, name: 'Conta ativada' })).toBeInTheDocument()
    expect(within(done).getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar')
    expect(authApi.bodies).toEqual([{ token: VALID_TOKEN, password: 'minha senha de profissional' }])
  })

  it('holds the button with the wait of a 429', async () => {
    server.use(
      http.post(`${API}/auth/invitations/accept`, () =>
        problem(429, 'RATE_LIMITED', {}, { 'Retry-After': '45' }),
      ),
    )
    const { user } = renderAt(PATHS.invitation(VALID_TOKEN))

    await user.type(await screen.findByLabelText('Nova senha'), 'minha senha de profissional')
    await user.click(screen.getByRole('button', { name: 'Ativar conta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Tente de novo em 45 segundos.')
    expect(screen.getByRole('button', { name: 'Aguarde 45 s' })).toBeDisabled()
  })
})
