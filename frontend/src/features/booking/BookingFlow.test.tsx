import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { components } from '@/api/schema'
import { createQueryClient } from '@/api/query-client'
import { Providers } from '@/app/providers'
import { BusinessPage } from '@/pages/public/BusinessPage'
import {
  API,
  bookingFor,
  OWNER_ID,
  problem,
  SERVICE_ID,
  slotsOf,
  TEAM_SERVICE_ID,
} from '@/test/msw/handlers'
import { server } from '@/test/msw/server'

type CreateBooking = components['schemas']['CreateBookingRequest']

const AVAILABILITY = `${API}/public/businesses/:slug/availability`
const APPOINTMENTS = `${API}/public/businesses/:slug/appointments`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 16:00 UTC: 13:00 of Tuesday, 10/11/2026 in São Paulo, but already 01:00 of
// Wednesday, 11/11 in Tokyo, where the tests run (D56).
const NOW = new Date('2026-11-10T16:00:00Z')

function renderPage(path = '/n/barbearia-demo') {
  const router = createMemoryRouter(
    [
      { path: '/n/:slug', Component: BusinessPage },
      { path: '/', element: <p>Página inicial</p> },
    ],
    { initialEntries: [path] },
  )
  const user = userEvent.setup()
  render(
    <Providers queryClient={createQueryClient({ queries: { retry: false } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { router, user }
}

type User = ReturnType<typeof userEvent.setup>

async function chooseService(user: User, name: string) {
  await user.click(await screen.findByRole('radio', { name }))
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
}

async function chooseSlot(user: User, time: string) {
  await user.click(await screen.findByRole('radio', { name: time }))
  await user.click(screen.getByRole('button', { name: `Continuar com ${time}` }))
  await screen.findByRole('heading', { level: 2, name: 'Seus dados' })
}

async function fillCustomer(user: User) {
  await user.type(screen.getByLabelText('Nome'), 'Ana Cliente')
  await user.type(screen.getByLabelText('E-mail'), 'ana@example.com')
  await user.type(screen.getByLabelText('Telefone'), '(11) 98765-4321')
}

/** Straight to the customer data: Corte, today, 09:00. */
async function reachCustomerStep(user: User) {
  await chooseService(user, 'Corte')
  await chooseSlot(user, '09:00')
  await fillCustomer(user)
}

/** Records every booking request, answering with `respond`. */
function recordBookings(respond: (body: CreateBooking, attempt: number) => Response | Promise<Response>) {
  const requests: { key: string | null; body: CreateBooking }[] = []
  server.use(
    http.post(APPOINTMENTS, async ({ request }) => {
      const body = (await request.json()) as CreateBooking
      requests.push({ key: request.headers.get('Idempotency-Key'), body })
      return respond(body, requests.length)
    }),
  )
  return requests
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('business page (UC10)', () => {
  it('shows the business, its active services and the demo notice', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Barbearia Demo' })).toBeInTheDocument()
    // Information, not an error: a status, never an alert.
    const notice = screen.getByText('Este é um negócio de demonstração').closest('[role="status"]')
    expect(notice).toBeInTheDocument()
    // D106: the API restores the demo once a day, after 03:00, at the first visit.
    expect(notice).toHaveTextContent('os dados voltam ao estado inicial todo dia')
    expect(screen.getByRole('heading', { level: 2, name: 'Escolha o serviço' })).toBeInTheDocument()

    const corte = screen.getByRole('radio', { name: 'Corte' })
    expect(corte).toHaveAccessibleDescription('30 min R$ 50,00')
    expect(screen.getByRole('radio', { name: 'Corte e barba' })).toHaveAccessibleDescription(
      '1 h 30 min R$ 80,00',
    )
    // Active, but without professionals: listed and not bookable.
    expect(screen.getByRole('radio', { name: 'Coloração' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    expect(document.title).toBe('Barbearia Demo | Agenda Inteligente')
  })

  it('shows "business not found" for an unknown slug, not a generic error', async () => {
    renderPage('/n/nao-existe')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Não encontramos este negócio' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers to try again when the page fails to load', async () => {
    let calls = 0
    server.use(
      http.get(`${API}/public/businesses/:slug`, () => {
        calls += 1
        return calls === 1 ? problem(500, 'INTERNAL_ERROR') : HttpResponse.json(null, { status: 404 })
      }),
    )
    const { user } = renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir a página')
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Não encontramos este negócio')).toBeInTheDocument()
  })
})

describe('day and time (UC10)', () => {
  it('shows the times in the time zone of the business, with the process in Asia/Tokyo', async () => {
    const queries: URLSearchParams[] = []
    server.use(
      http.get(AVAILABILITY, ({ request }) => {
        const query = new URL(request.url).searchParams
        queries.push(query)
        return HttpResponse.json({ date: query.get('date'), slots: slotsOf(query.get('date')!) })
      }),
    )
    const { user } = renderPage()

    await chooseService(user, 'Corte')

    // Only one professional does it: the step is skipped (3 steps, not 4).
    const step = await screen.findByRole('region', { name: 'Escolha o dia e o horário' })
    expect(within(step).getByText(/2 de 3/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Escolha o dia e o horário' })).toHaveFocus()

    // Today is Tuesday 10/11 in São Paulo, although it is already the 11th in Tokyo.
    const days = within(screen.getByRole('radiogroup', { name: 'Dia' })).getAllByRole('radio')
    expect(days[0]).toHaveAccessibleName('Hoje, terça-feira, 10/11/2026')
    expect(days[0]).toBeChecked()
    expect(days).toHaveLength(31)

    expect(await screen.findByRole('radio', { name: '09:00' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '14:00' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '18:30' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '21:00' })).not.toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: /Manhã$/ })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: /Tarde$/ })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: /Noite$/ })).toBeInTheDocument()
    expect(screen.getByText(/fuso do negócio \(São Paulo e Brasília\)/)).toBeInTheDocument()

    expect(queries[0].get('date')).toBe('2026-11-10')
    expect(queries[0].get('service_id')).toBe(SERVICE_ID)
  })

  it('moves between days and times with the arrow keys', async () => {
    server.use(
      http.get(AVAILABILITY, ({ request }) => {
        const date = new URL(request.url).searchParams.get('date')!
        return HttpResponse.json({ date, slots: slotsOf(date, ['09:00', '09:30', '14:00']) })
      }),
    )
    const { user, router } = renderPage(`/n/barbearia-demo?servico=${SERVICE_ID}`)

    const today = await screen.findByRole('radio', { name: /^Hoje/ })
    today.focus()
    await user.keyboard('{ArrowRight}')
    const tomorrow = screen.getByRole('radio', { name: 'quarta-feira, 11/11/2026' })
    expect(tomorrow).toBeChecked()
    expect(tomorrow).toHaveFocus()
    expect(router.state.location.search).toContain('dia=2026-11-11')

    await user.click(await screen.findByRole('radio', { name: '09:00' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: '09:30' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '09:30' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Continuar com 09:30' })).toBeEnabled()
    // 14:00 is in another group (afternoon): the arrows wrap inside the morning.
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: '09:00' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('radio', { name: '09:30' })).toHaveFocus()
  })

  it('shows an empty state on a day without times and suggests the next day', async () => {
    server.use(
      http.get(AVAILABILITY, ({ request }) => {
        const date = new URL(request.url).searchParams.get('date')!
        // Out of the minimum advance today: the API answers 200 with no slots.
        return HttpResponse.json({ date, slots: date === '2026-11-10' ? [] : slotsOf(date) })
      }),
    )
    const { user, router } = renderPage(`/n/barbearia-demo?servico=${SERVICE_ID}`)

    expect(await screen.findByText('Sem horários livres neste dia')).toBeInTheDocument()
    // Nothing to continue with: the empty state already offers the next day.
    expect(screen.queryByRole('button', { name: /Continuar/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Ver quarta-feira/ }))

    expect(await screen.findByRole('radio', { name: '09:00' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'quarta-feira, 11/11/2026' })).toBeChecked()
    expect(router.state.location.search).toContain('dia=2026-11-11')
  })

  it('points to an earlier day when the last open day is empty', async () => {
    server.use(
      http.get(AVAILABILITY, ({ request }) =>
        HttpResponse.json({ date: new URL(request.url).searchParams.get('date'), slots: [] }),
      ),
    )
    renderPage(`/n/barbearia-demo?servico=${SERVICE_ID}&dia=2026-12-10`)

    expect(await screen.findByText(/até 30 dias de antecedência/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Ver / })).not.toBeInTheDocument()
  })

  it('shows the error of the slots with a retry', async () => {
    let calls = 0
    server.use(
      http.get(AVAILABILITY, ({ request }) => {
        calls += 1
        const date = new URL(request.url).searchParams.get('date')!
        return calls === 1
          ? problem(429, 'RATE_LIMITED', {}, { 'Retry-After': '20' })
          : HttpResponse.json({ date, slots: slotsOf(date) })
      }),
    )
    const { user } = renderPage(`/n/barbearia-demo?servico=${SERVICE_ID}`)

    expect(await screen.findByRole('alert')).toHaveTextContent('Tente de novo em 20 segundos.')
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('radio', { name: '09:00' })).toBeInTheDocument()
  })

  it('asks for the professional when there is more than one, and "any" sends none', async () => {
    const queries: URLSearchParams[] = []
    server.use(
      http.get(AVAILABILITY, ({ request }) => {
        const query = new URL(request.url).searchParams
        queries.push(query)
        return HttpResponse.json({ date: query.get('date'), slots: slotsOf(query.get('date')!) })
      }),
    )
    const { user, router } = renderPage()

    await chooseService(user, 'Corte e barba')
    expect(await screen.findByRole('heading', { level: 2, name: 'Escolha o profissional' })).toHaveFocus()
    expect(screen.getByText(/2 de 4/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Qualquer profissional' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await screen.findByRole('radio', { name: '09:00' })
    expect(queries.at(-1)?.has('professional_id')).toBe(false)
    expect(router.state.location.search).toBe(`?servico=${TEAM_SERVICE_ID}&profissional=qualquer`)

    // The summary changes the professional, and a chosen one goes to the API.
    await user.click(screen.getAllByRole('button', { name: 'Alterar profissional' })[0])
    await user.click(await screen.findByRole('radio', { name: 'Dono Demo' }))
    await user.click(screen.getByRole('button', { name: 'Continuar' }))
    await screen.findByRole('radio', { name: '09:00' })
    expect(queries.at(-1)?.get('professional_id')).toBe(OWNER_ID)
  })

  it('ignores invalid parameters and starts at the right step', async () => {
    renderPage(`/n/barbearia-demo?servico=${TEAM_SERVICE_ID}&profissional=outro&dia=2099-01-01`)

    expect(await screen.findByRole('heading', { level: 2, name: 'Escolha o profissional' })).toBeInTheDocument()
  })

  it('goes back one step with the back button', async () => {
    const { user, router } = renderPage()

    await chooseService(user, 'Corte')
    await screen.findByRole('heading', { level: 2, name: 'Escolha o dia e o horário' })
    await router.navigate(-1)

    expect(await screen.findByRole('heading', { level: 2, name: 'Escolha o serviço' })).toBeInTheDocument()
  })
})

describe('customer data and booking (UC11)', () => {
  it('validates the fields with texts in Portuguese', async () => {
    const requests = recordBookings((body) => HttpResponse.json(bookingFor(body), { status: 201 }))
    const { user } = renderPage()
    await chooseService(user, 'Corte')
    await chooseSlot(user, '09:00')

    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))

    expect(await screen.findByText('Informe seu nome.')).toBeInTheDocument()
    expect(screen.getByText('Informe seu e-mail.')).toBeInTheDocument()
    expect(screen.getByText('Informe seu telefone.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveFocus()
    expect(screen.getByLabelText('Nome')).toHaveAccessibleDescription('Informe seu nome.')

    await user.type(screen.getByLabelText('E-mail'), 'ana@')
    await user.type(screen.getByLabelText('Telefone'), '1234')
    await user.tab()
    expect(await screen.findByText('Informe um e-mail válido, como nome@exemplo.com.')).toBeInTheDocument()
    expect(screen.getByText('Informe o telefone com DDD, como (11) 98765-4321.')).toBeInTheDocument()
    expect(requests).toHaveLength(0)
  })

  it('sends one creation for two clicks, with an idempotency key, and shows the success', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const requests = recordBookings(async (body) => {
      await held
      return HttpResponse.json(bookingFor(body), { status: 201 })
    })
    const { user } = renderPage()
    await reachCustomerStep(user)

    const button = screen.getByRole('button', { name: 'Confirmar agendamento' })
    await user.dblClick(button)
    expect(await screen.findByRole('button', { name: /Confirmando/ })).toBeDisabled()
    release()

    const heading = await screen.findByRole('heading', { level: 2, name: 'Agendamento confirmado' })
    // The heading takes the focus in a useEffect. The response of the API is
    // rendered outside act(), so the effect may run after findByRole resolves.
    await waitFor(() => expect(heading).toHaveFocus())
    expect(requests).toHaveLength(1)
    expect(requests[0].key).toMatch(UUID)
    expect(requests[0].body).toEqual({
      service_id: SERVICE_ID,
      professional_id: '5d0c7e42-0000-4000-8000-000000000002',
      starts_at: '2026-11-10T09:00:00-03:00',
      customer: { name: 'Ana Cliente', email: 'ana@example.com', phone: '+5511987654321' },
    })
  })

  it('shows the summary in the time zone of the business and copies the link', async () => {
    const { user } = renderPage()
    await reachCustomerStep(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))

    const success = await screen.findByRole('region', { name: 'Agendamento confirmado' })
    expect(within(success).getByText('Corte')).toBeInTheDocument()
    expect(within(success).getByText('Profissional Demo')).toBeInTheDocument()
    expect(within(success).getByText('terça-feira, 10/11/2026')).toBeInTheDocument()
    expect(within(success).getByText('09:00–09:30')).toBeInTheDocument()
    expect(within(success).getByText(/consulta, cancela ou remarca/)).toBeInTheDocument()
    expect(within(success).getByText('ana@example.com')).toBeInTheDocument()

    const link = screen.getByRole('textbox', { name: 'Link do seu agendamento' })
    expect(link).toHaveValue('https://app.exemplo.com/agendamento/token-de-teste')

    await user.click(screen.getByRole('button', { name: 'Copiar link' }))
    expect(await screen.findByText('Link copiado.')).toHaveAttribute('role', 'status')
    await expect(navigator.clipboard.readText()).resolves.toBe(
      'https://app.exemplo.com/agendamento/token-de-teste',
    )

    await user.click(screen.getByRole('button', { name: 'Fazer outro agendamento' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Escolha o serviço' })).toBeInTheDocument()
  })

  it('selects the link when the clipboard is not available', async () => {
    const { user } = renderPage()
    await reachCustomerStep(user)
    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
    await screen.findByRole('heading', { level: 2, name: 'Agendamento confirmado' })
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))

    await user.click(screen.getByRole('button', { name: 'Copiar link' }))

    expect(await screen.findByText(/copie com o menu do aparelho/)).toHaveAttribute('role', 'status')
    expect(screen.getByRole('textbox', { name: 'Link do seu agendamento' })).toHaveFocus()
  })

  it('resends the same key after a network failure', async () => {
    const requests = recordBookings((body, attempt) =>
      attempt === 1
        ? HttpResponse.error()
        : HttpResponse.json(bookingFor(body, { access_url: null, email_status: 'unchanged' })),
    )
    const { user } = renderPage()
    await reachCustomerStep(user)

    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar ao servidor')
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    // The first one had reached the API: the repetition brings the same booking, without the link.
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Este agendamento já estava confirmado' }),
    ).toBeInTheDocument()
    expect(screen.getByText('O link foi enviado para o seu e-mail')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copiar link' })).not.toBeInTheDocument()
    expect(requests).toHaveLength(2)
    expect(requests[1].key).toBe(requests[0].key)
  })

  it('goes back to the updated times on 409, keeping the typed data', async () => {
    let taken = false
    server.use(
      http.get(AVAILABILITY, ({ request }) => {
        const date = new URL(request.url).searchParams.get('date')!
        const times = taken ? ['14:00', '18:30'] : ['09:00', '14:00', '18:30']
        return HttpResponse.json({ date, slots: slotsOf(date, times) })
      }),
    )
    const requests = recordBookings((body, attempt) => {
      if (attempt === 1) {
        taken = true
        return problem(409, 'SLOT_UNAVAILABLE')
      }
      return HttpResponse.json(bookingFor(body), { status: 201 })
    })
    const { user } = renderPage()
    await reachCustomerStep(user)

    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Escolha o dia e o horário' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Esse horário acabou de ser reservado')
    expect(screen.getByRole('alert')).toHaveTextContent('terça-feira às 09:00')
    expect(screen.queryByRole('radio', { name: '09:00' })).not.toBeInTheDocument()

    await chooseSlot(user, '14:00')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Ana Cliente')
    expect(screen.getByLabelText('Telefone')).toHaveValue('(11) 98765-4321')

    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
    await screen.findByRole('heading', { level: 2, name: 'Agendamento confirmado' })
    expect(requests).toHaveLength(2)
    expect(requests[1].body.starts_at).toBe('2026-11-10T14:00:00-03:00')
    // Another body is another attempt, with its own key (D64).
    expect(requests[1].key).not.toBe(requests[0].key)
  })

  it('shows how long to wait on 429 and holds the button meanwhile', async () => {
    recordBookings(() => problem(429, 'RATE_LIMITED', {}, { 'Retry-After': '30' }))
    const { user } = renderPage()
    await reachCustomerStep(user)

    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Tente de novo em 30 segundos.')
    expect(screen.getByRole('button', { name: 'Aguarde 30 s' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()

    vi.setSystemTime(new Date(NOW.getTime() + 31_000))
    expect(await screen.findByRole('button', { name: 'Confirmar agendamento' })).toBeEnabled()
  })

  it('shows the link only on the screen when the e-mail limit was hit', async () => {
    recordBookings((body) =>
      HttpResponse.json(bookingFor(body, { email_status: 'skipped' }), { status: 201 }),
    )
    const { user } = renderPage()
    await reachCustomerStep(user)

    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))

    expect(await screen.findByRole('textbox', { name: 'Link do seu agendamento' })).toHaveValue(
      'https://app.exemplo.com/agendamento/token-de-teste',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('O e-mail não foi enviado')
    expect(screen.getByRole('alert')).toHaveTextContent('este link só aparece nesta tela')
    expect(screen.queryByText(/Também enviamos o link/)).not.toBeInTheDocument()
  })

  it('shows our own text on the field the API refused', async () => {
    recordBookings(() =>
      problem(422, 'VALIDATION_ERROR', {
        errors: [{ loc: ['body', 'customer', 'email'], msg: 'value is not a valid email', type: 'value_error' }],
      }),
    )
    const { user } = renderPage()
    await reachCustomerStep(user)

    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))

    expect(await screen.findByText('Informe um e-mail válido, como nome@exemplo.com.')).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toHaveFocus()
    expect(screen.queryByText('value is not a valid email')).not.toBeInTheDocument()
  })

  it('starts a new attempt after IDEMPOTENCY_KEY_REUSED', async () => {
    const requests = recordBookings((body, attempt) =>
      attempt === 1
        ? problem(409, 'IDEMPOTENCY_KEY_REUSED')
        : HttpResponse.json(bookingFor(body), { status: 201 }),
    )
    const { user } = renderPage()
    await reachCustomerStep(user)

    await user.click(screen.getByRole('button', { name: 'Confirmar agendamento' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('já foi enviada com outros dados')
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    await screen.findByRole('heading', { level: 2, name: 'Agendamento confirmado' })
    expect(requests[1].key).not.toBe(requests[0].key)
  })

  it('changes the slot from the summary, keeping it chosen', async () => {
    const { user } = renderPage()
    await reachCustomerStep(user)

    const [summary] = screen.getAllByRole('complementary', { name: 'Resumo do agendamento' })
    expect(within(summary).getByText('às 09:00')).toBeInTheDocument()
    await user.click(within(summary).getByRole('button', { name: 'Alterar horário' }))

    expect(await screen.findByRole('radio', { name: '09:00' })).toBeChecked()
    await user.click(within(summary).getByRole('button', { name: 'Alterar serviço' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Escolha o serviço' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Corte' })).not.toBeChecked()
  })
})

describe('waits for the slots before the customer step', () => {
  it('keeps the slot chosen in the history entry once the list confirms it', async () => {
    const { router } = renderPage()
    await router.navigate(`/n/barbearia-demo?servico=${SERVICE_ID}`, {
      state: { slot: '2026-11-10T14:00:00-03:00' },
    })

    expect(await screen.findByRole('heading', { level: 2, name: 'Seus dados' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('às 14:00')[0]).toBeInTheDocument())
  })

  it('ignores a slot that the list no longer offers', async () => {
    const { router } = renderPage()
    await router.navigate(`/n/barbearia-demo?servico=${SERVICE_ID}`, {
      state: { slot: '2026-11-10T10:00:00-03:00' },
    })

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Escolha o dia e o horário' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: '09:00' })).not.toBeChecked()
  })
})
