import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { components } from '@/api/schema'
import { createQueryClient } from '@/api/query-client'
import { Providers } from '@/app/providers'
import { CustomerAppointmentPage } from '@/pages/public/CustomerAppointmentPage'
import {
  API,
  demoBusiness,
  LINK_TOKEN,
  linkAppointment,
  OWNER_ID,
  problem,
  PROFESSIONAL_ID,
  rescheduledFrom,
  slotsOf,
  TEAM_SERVICE_ID,
} from '@/test/msw/handlers'
import { server } from '@/test/msw/server'

type CustomerAppointment = components['schemas']['CustomerAppointmentResponse']
type Reschedule = components['schemas']['RescheduleRequest']

const LINK = `${API}/public/appointments/:token`
const CANCEL = `${LINK}/cancel`
const RESCHEDULE = `${LINK}/reschedule`
const BUSINESS = `${API}/public/businesses/:slug`
const AVAILABILITY = `${BUSINESS}/availability`

// 13:00 of Tuesday, 10/11/2026 in São Paulo; already Wednesday in Tokyo (D56).
const NOW = new Date('2026-11-10T16:00:00Z')

function renderPage(token = LINK_TOKEN) {
  const router = createMemoryRouter(
    [
      { path: '/agendamento/:token', Component: CustomerAppointmentPage },
      { path: '/n/:slug', element: <p>Página do negócio</p> },
      { path: '/', element: <p>Página inicial</p> },
    ],
    { initialEntries: [`/agendamento/${token}`] },
  )
  const user = userEvent.setup()
  render(
    <Providers queryClient={createQueryClient({ queries: { retry: false } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { router, user }
}

/** Serves `appointment` on the link, and each next answer from `next` after a change. */
function serveLink(appointment: CustomerAppointment) {
  let current = appointment
  server.use(http.get(LINK, () => HttpResponse.json(current)))
  return (next: CustomerAppointment) => {
    current = next
  }
}

/** A paragraph by its whole text, even when parts of it are in their own elements. */
function paragraph(text: string) {
  return (_: string, node: Element | null) => node?.tagName === 'P' && node.textContent === text
}

async function findSummary() {
  return within(await screen.findByRole('region', { name: 'Seu agendamento' }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('customer link (UC12)', () => {
  it('shows the appointment in the time zone of the business, with what it allows', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Barbearia Demo' })).toBeInTheDocument()
    const summary = await findSummary()
    expect(summary.getByText('Confirmado')).toBeInTheDocument()
    expect(summary.getByText('Corte e barba')).toBeInTheDocument()
    expect(summary.getByText('1 h 30 min · R$ 80,00')).toBeInTheDocument()
    expect(summary.getByText('Profissional Demo')).toBeInTheDocument()
    expect(summary.getByText('quinta-feira, 12/11/2026')).toBeInTheDocument()
    expect(summary.getByText('10:00–11:30')).toBeInTheDocument()
    expect(
      screen.getByText((_, node) => node?.tagName === 'P' && /remarcar ou cancelar até/.test(node.textContent ?? '')),
    ).toHaveTextContent('Você pode remarcar ou cancelar até quinta-feira, 12/11/2026 às 08:00.')
    expect(screen.getByRole('button', { name: 'Remarcar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar agendamento' })).toBeInTheDocument()
    expect(document.title).toBe('Seu agendamento em Barbearia Demo | Agenda Inteligente')
    expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  })

  it('tells an invalid link apart from a failure, with the same page for every 404 (D18)', async () => {
    renderPage('nao-existe')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Este link não abre mais o agendamento' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/')
    expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  })

  it('offers a retry when the link could not be read', async () => {
    let calls = 0
    server.use(
      http.get(LINK, () => {
        calls += 1
        return calls === 1 ? HttpResponse.error() : HttpResponse.json(linkAppointment())
      }),
    )
    const { user } = renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir o agendamento')
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('button', { name: 'Remarcar' })).toBeInTheDocument()
  })

  it('points to the business once the deadline passed, without actions (RN17)', async () => {
    serveLink(linkAppointment({ can_cancel: false, can_reschedule: false }))
    renderPage()

    expect(await screen.findByText('O prazo para alterar pelo link terminou')).toBeInTheDocument()
    expect(screen.getByText(/fale com Barbearia Demo/)).toHaveTextContent(
      'Dava para cancelar ou remarcar até quinta-feira, 12/11/2026 às 08:00.',
    )
    expect(screen.getByRole('link', { name: 'Ver a página de Barbearia Demo' })).toHaveAttribute(
      'href',
      '/n/barbearia-demo',
    )
    expect(screen.queryByRole('button', { name: 'Remarcar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar agendamento' })).not.toBeInTheDocument()
  })

  it('only cancels when the service left the business (D21)', async () => {
    serveLink(linkAppointment({ can_reschedule: false }))
    renderPage()

    expect(await screen.findByRole('button', { name: 'Cancelar agendamento' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remarcar' })).not.toBeInTheDocument()
    expect(screen.getByText(/Você pode cancelar até/)).toHaveTextContent(
      'não dá para remarcar pelo link',
    )
  })

  it.each([
    ['cancelled', 'Cancelado', 'Este agendamento foi cancelado, e o horário ficou livre.'],
    ['completed', 'Concluído', 'Este atendimento foi concluído.'],
  ] as const)('links a %s appointment to a new booking (D69)', async (status, label, text) => {
    serveLink(linkAppointment({ status, can_cancel: false, can_reschedule: false }))
    renderPage()

    const summary = await findSummary()
    expect(summary.getByText(label)).toBeInTheDocument()
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Fazer novo agendamento em Barbearia Demo' }),
    ).toHaveAttribute('href', '/n/barbearia-demo')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows a no-show without any link (D69)', async () => {
    serveLink(linkAppointment({ status: 'no_show', can_cancel: false, can_reschedule: false }))
    renderPage()

    const summary = await findSummary()
    expect(summary.getByText('Não compareceu')).toBeInTheDocument()
    expect(screen.getByText('Este horário foi registrado como não comparecimento.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /novo agendamento/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('cancel (UC13, D67)', () => {
  it('asks first, and Esc keeps the appointment and gives the focus back', async () => {
    const requests: number[] = []
    server.use(http.post(CANCEL, () => {
      requests.push(1)
      return HttpResponse.json({})
    }))
    const { user } = renderPage()

    const trigger = await screen.findByRole('button', { name: 'Cancelar agendamento' })
    await user.click(trigger)

    const dialog = await screen.findByRole('alertdialog', { name: 'Cancelar este agendamento?' })
    expect(dialog).toHaveAccessibleDescription(
      'Corte e barba com Profissional Demo, quinta-feira, 12/11/2026 às 10:00. O horário fica livre para outra pessoa, e o cancelamento não pode ser desfeito.',
    )
    // The safe choice takes the focus (Radix), so Enter never cancels by accident.
    expect(within(dialog).getByRole('button', { name: 'Manter agendamento' })).toHaveFocus()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(requests).toHaveLength(0)
  })

  it('cancels, says so and moves the focus to the answer', async () => {
    const update = serveLink(linkAppointment())
    let calls = 0
    server.use(
      http.post(CANCEL, () => {
        calls += 1
        const cancelled = linkAppointment({ status: 'cancelled', can_cancel: false, can_reschedule: false })
        update(cancelled)
        return HttpResponse.json({ ...cancelled, email_status: 'queued' })
      }),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Cancelar agendamento' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.dblClick(within(dialog).getByRole('button', { name: 'Cancelar agendamento' }))

    const notice = await screen.findByText('Agendamento cancelado')
    await waitFor(() => expect(notice).toHaveFocus())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByText(paragraph('Enviamos a confirmação para o seu e-mail.'))).toBeInTheDocument()
    expect((await findSummary()).getByText('Cancelado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fazer novo agendamento em Barbearia Demo' })).toBeInTheDocument()
    expect(calls).toBe(1)
  })

  it('says when the e-mail was not sent, though the cancel holds (RN26)', async () => {
    server.use(
      http.post(CANCEL, () =>
        HttpResponse.json({
          ...linkAppointment({ status: 'cancelled', can_cancel: false, can_reschedule: false }),
          email_status: 'skipped',
        }),
      ),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Cancelar agendamento' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar agendamento' }))

    expect(
      await screen.findByText(
        paragraph(
          'O cancelamento já vale em Barbearia Demo, mas não conseguimos enviar o e-mail de confirmação agora.',
        ),
      ),
    ).toBeInTheDocument()
  })

  it('reads the link again after a final refusal, such as the deadline (409)', async () => {
    const update = serveLink(linkAppointment())
    server.use(
      http.post(CANCEL, () => {
        update(linkAppointment({ can_cancel: false, can_reschedule: false }))
        return problem(409, 'CHANGE_DEADLINE_PASSED')
      }),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Cancelar agendamento' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar agendamento' }))

    const notice = await screen.findByText('Não foi possível concluir')
    await waitFor(() => expect(notice).toHaveFocus())
    expect(screen.getByText(/O prazo para alterar este agendamento já passou/)).toBeInTheDocument()
    expect(await screen.findByText('O prazo para alterar pelo link terminou')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps the dialog open after a rate limit, holding the button (429)', async () => {
    server.use(http.post(CANCEL, () => problem(429, 'RATE_LIMITED', {}, { 'Retry-After': '30' })))
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Cancelar agendamento' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar agendamento' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Tente de novo em 30 segundos.')
    expect(within(dialog).getByRole('button', { name: 'Aguarde 30 s' })).toBeDisabled()
  })

  it('keeps the dialog open after a network failure, to try again', async () => {
    let calls = 0
    server.use(
      http.post(CANCEL, () => {
        calls += 1
        return calls === 1
          ? HttpResponse.error()
          : HttpResponse.json({
              ...linkAppointment({ status: 'cancelled', can_cancel: false, can_reschedule: false }),
              email_status: 'queued',
            })
      }),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Cancelar agendamento' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar agendamento' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Não foi possível cancelar')

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar agendamento' }))

    expect(await screen.findByText('Agendamento cancelado')).toBeInTheDocument()
    expect(calls).toBe(2)
  })
})

describe('reschedule (UC14, D68)', () => {
  it('starts with the current professional and day, and moves the appointment', async () => {
    const requests: Reschedule[] = []
    server.use(
      http.post(RESCHEDULE, async ({ request }) => {
        const body = (await request.json()) as Reschedule
        requests.push(body)
        return HttpResponse.json(rescheduledFrom(linkAppointment(), body))
      }),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remarcar' }))

    const heading = await screen.findByRole('heading', { level: 2, name: 'Escolha o novo horário' })
    expect(heading).toHaveFocus()
    expect(screen.getByRole('heading', { level: 2, name: 'Horário atual' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Profissional Demo' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Profissional Demo' })).toHaveAccessibleDescription(
      'Atende o agendamento atual',
    )
    expect(screen.getByRole('radio', { name: 'quinta-feira, 12/11/2026' })).toBeChecked()

    await user.click(await screen.findByRole('radio', { name: '14:00' }))
    await user.click(screen.getByRole('button', { name: 'Remarcar para 14:00' }))

    const notice = await screen.findByText('Agendamento remarcado')
    await waitFor(() => expect(notice).toHaveFocus())
    expect(screen.getByText('Este link continua valendo para o novo horário.')).toBeInTheDocument()
    expect(requests).toEqual([{ starts_at: '2026-11-12T14:00:00-03:00', professional_id: PROFESSIONAL_ID }])
    expect((await findSummary()).getByText('14:00–15:30')).toBeInTheDocument()
  })

  it('starts with "any professional" when the current one no longer does the service', async () => {
    const requests: Reschedule[] = []
    server.use(
      http.get(BUSINESS, () =>
        HttpResponse.json({
          ...demoBusiness,
          services: demoBusiness.services.map((service) =>
            service.id === TEAM_SERVICE_ID
              ? { ...service, professional_ids: [OWNER_ID, '5d0c7e42-0000-4000-8000-000000000004'] }
              : service,
          ),
          professionals: [
            ...demoBusiness.professionals,
            { id: '5d0c7e42-0000-4000-8000-000000000004', name: 'Terceira Demo' },
          ],
        }),
      ),
      http.post(RESCHEDULE, async ({ request }) => {
        const body = (await request.json()) as Reschedule
        requests.push(body)
        return HttpResponse.json(rescheduledFrom(linkAppointment(), { ...body, professional_id: OWNER_ID }))
      }),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remarcar' }))

    expect(await screen.findByRole('radio', { name: 'Qualquer profissional' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Profissional Demo' })).not.toBeInTheDocument()

    await user.click(await screen.findByRole('radio', { name: '09:00' }))
    await user.click(screen.getByRole('button', { name: 'Remarcar para 09:00' }))

    await screen.findByText('Agendamento remarcado')
    expect(requests).toEqual([{ starts_at: '2026-11-12T09:00:00-03:00', professional_id: null }])
    expect((await findSummary()).getByText('Dono Demo')).toBeInTheDocument()
  })

  it('asks for the slots of the chosen professional', async () => {
    const asked: (string | null)[] = []
    server.use(
      http.get(AVAILABILITY, ({ request }) => {
        const url = new URL(request.url)
        asked.push(url.searchParams.get('professional_id'))
        const date = url.searchParams.get('date') ?? ''
        return HttpResponse.json({ date, slots: slotsOf(date) })
      }),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remarcar' }))
    await screen.findByRole('radio', { name: '14:00' })
    await user.click(screen.getByRole('radio', { name: 'Qualquer profissional' }))
    await screen.findByRole('radio', { name: '14:00' })

    await waitFor(() => expect(asked).toEqual([PROFESSIONAL_ID, null]))
  })

  it('goes back to the slots, already updated, when the time was taken (409)', async () => {
    let reads = 0
    server.use(
      http.get(AVAILABILITY, ({ request }) => {
        reads += 1
        const date = new URL(request.url).searchParams.get('date') ?? ''
        return HttpResponse.json({ date, slots: slotsOf(date, reads === 1 ? ['09:00', '14:00'] : ['09:00']) })
      }),
      http.post(RESCHEDULE, () => problem(409, 'SLOT_UNAVAILABLE')),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remarcar' }))
    await user.click(await screen.findByRole('radio', { name: '14:00' }))
    await user.click(screen.getByRole('button', { name: 'Remarcar para 14:00' }))

    expect(await screen.findByText('Esse horário acabou de ser reservado')).toBeInTheDocument()
    expect(screen.getByText(/Seu agendamento continua no horário atual/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('radio', { name: '14:00' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Remarcar' })).toBeDisabled()
    expect((await findSummaryOf('Horário atual')).getByText('10:00–11:30')).toBeInTheDocument()
  })

  it('shows other failures in the form, keeping the choice', async () => {
    server.use(http.post(RESCHEDULE, () => problem(503, 'DATABASE_UNAVAILABLE')))
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remarcar' }))
    await user.click(await screen.findByRole('radio', { name: '14:00' }))
    await user.click(screen.getByRole('button', { name: 'Remarcar para 14:00' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível remarcar')
    expect(screen.getByRole('button', { name: 'Remarcar para 14:00' })).toBeEnabled()
  })

  it('leaves the reschedule after a final refusal, showing the link as it is now', async () => {
    const update = serveLink(linkAppointment())
    server.use(
      http.post(RESCHEDULE, () => {
        update(linkAppointment({ status: 'cancelled', can_cancel: false, can_reschedule: false }))
        return problem(409, 'INVALID_STATUS_TRANSITION')
      }),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remarcar' }))
    await user.click(await screen.findByRole('radio', { name: '14:00' }))
    await user.click(screen.getByRole('button', { name: 'Remarcar para 14:00' }))

    expect(await screen.findByText('Não foi possível concluir')).toBeInTheDocument()
    expect(await (await findSummary()).findByText('Cancelado')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Escolha o novo horário' })).not.toBeInTheDocument()
  })

  it('gives the focus back to "Remarcar" when the current time is kept', async () => {
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remarcar' }))
    await user.click(await screen.findByRole('button', { name: 'Manter o horário atual' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remarcar' })).toHaveFocus())
    expect(screen.queryByRole('heading', { name: 'Escolha o novo horário' })).not.toBeInTheDocument()
  })

  it('says so when the service left the public page in the meantime', async () => {
    server.use(
      http.get(BUSINESS, () =>
        HttpResponse.json({
          ...demoBusiness,
          services: demoBusiness.services.filter((service) => service.id !== TEAM_SERVICE_ID),
        }),
      ),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remarcar' }))

    expect(await screen.findByText('Este serviço não está mais disponível')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manter o horário atual' })).toBeInTheDocument()
  })

  it('offers a retry when the business could not be read', async () => {
    let calls = 0
    server.use(
      http.get(BUSINESS, () => {
        calls += 1
        return calls === 1 ? HttpResponse.error() : HttpResponse.json(demoBusiness)
      }),
    )
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remarcar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os horários')
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('radio', { name: '14:00' })).toBeInTheDocument()
  })

  it('holds the button after a rate limit (429)', async () => {
    server.use(http.post(RESCHEDULE, () => problem(429, 'RATE_LIMITED', {}, { 'Retry-After': '5' })))
    const { user } = renderPage()

    await user.click(await screen.findByRole('button', { name: 'Remarcar' }))
    await user.click(await screen.findByRole('radio', { name: '14:00' }))
    await user.click(screen.getByRole('button', { name: 'Remarcar para 14:00' }))

    expect(await screen.findByRole('button', { name: 'Aguarde 5 s' })).toBeDisabled()
  })
})

async function findSummaryOf(name: string) {
  return within(await screen.findByRole('region', { name }))
}
