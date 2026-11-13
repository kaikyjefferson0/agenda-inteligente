import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { Providers } from '@/app/providers'
import { routes } from '@/app/router'
import { API, problem } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'
import {
  APPOINTMENT_IDS,
  BRUNO_ID,
  slotRefused,
  staffAppointment,
  teamApi,
} from '@/test/msw/team-agenda'
import { withOpenSession } from '@/test/session'

// 13:00 of Thursday, 12/11/2026 in São Paulo; already Friday, 01:00, in Tokyo (D56).
const NOW = new Date('2026-11-12T16:00:00Z')

type User = ReturnType<typeof userEvent.setup>

async function renderAgenda(path = '/painel', role: 'owner' | 'professional' = 'owner') {
  await withOpenSession(role)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  render(
    <Providers queryClient={createQueryClient({ queries: { retry: false } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  // The panel group is loaded on demand (D54): the first import, under the load of the whole suite, takes longer.
  await screen.findByRole('heading', { level: 1, name: 'Agenda' }, { timeout: 10_000 })
  return { router, user }
}

const where = (router: Awaited<ReturnType<typeof renderAgenda>>['router']) =>
  `${router.state.location.pathname}${router.state.location.search}`

/** The day list of the phone. */
async function dayList() {
  return within(await screen.findByRole('list', { name: 'Agendamentos do dia' }, { timeout: 5_000 }))
}

/** The card (phone) of a customer, which opens the sheet. */
async function openCard(user: User, customer: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(customer) }))
  return within(await screen.findByRole('dialog'))
}

/** Picks an option of a shadcn select by the label of its field. */
async function choose(user: User, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: new RegExp(`^${option}`) }))
}

/** `matchMedia` answering `true` only for the queries of `matches` (as `setup.ts`, by default none). */
function mediaMatching(matches: (query: string) => boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

/** From 1024 px: the grid and the week (D80). */
const asDesktop = () => mediaMatching((query) => query === '(min-width: 1024px)')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  mediaMatching(() => false)
})

describe('agenda of the day (UC15)', () => {
  it('shows the day of the business, not of the browser, with one request for the week', async () => {
    await renderAgenda()

    expect(await screen.findByText('quinta-feira, 12/11/2026')).toBeInTheDocument()
    const list = await dayList()
    const cards = list.getAllByRole('button').map((card) => card.textContent)
    expect(cards).toEqual([
      expect.stringMatching(/^09:0009:30CorteCarlos Diascom Dona AnaConcluído/),
      expect.stringMatching(/^11:0011:30CorteDiego Rochacom Bruno LimaConfirmadoRegistrar resultado/),
      expect.stringMatching(/^14:0014:30CorteElisa Pradocom Bruno LimaConfirmado$/),
      expect.stringMatching(/^15:0015:20BarbaFábio Nunescom Dona AnaConfirmado$/),
    ])
    // "Now" sits between what started and what is to come.
    expect(list.getByRole('listitem', { name: 'Agora, 13:00' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelados (1)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Hoje, quinta-feira, 12/11/2026, com agendamentos' })).toBeChecked()

    expect(teamApi.agendaRequests).toHaveLength(1)
    const [query] = teamApi.agendaRequests
    expect(query.get('from')).toBe('2026-11-09T03:00:00Z')
    expect(query.get('to')).toBe('2026-11-16T03:00:00Z')
    expect(query.has('professional_id')).toBe(false)
  })

  it('goes through the days of the week without new requests, and fetches the next week', async () => {
    const { router, user } = await renderAgenda()
    await dayList()

    await user.click(screen.getByRole('button', { name: 'Próximo dia' }))
    // Under the load of the whole suite with coverage, the new day may take longer than the default 1 s.
    expect(await screen.findByText('sexta-feira, 13/11/2026', {}, { timeout: 5_000 })).toBeInTheDocument()
    expect((await dayList()).getByRole('button', { name: /Helena Reis/ })).toBeInTheDocument()
    expect(where(router)).toBe('/painel?dia=2026-11-13')
    expect(teamApi.agendaRequests).toHaveLength(1)

    await user.click(screen.getByRole('radio', { name: /domingo, 15\/11\/2026/ }))
    expect(await screen.findByText('Nenhum agendamento neste dia')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Próximo dia' }))
    await waitFor(() => expect(teamApi.agendaRequests).toHaveLength(2))
    expect(teamApi.agendaRequests[1].get('from')).toBe('2026-11-16T03:00:00Z')

    await user.click(screen.getByRole('button', { name: 'Hoje' }))
    expect(await screen.findByText('quinta-feira, 12/11/2026')).toBeInTheDocument()
    expect(where(router)).toBe('/painel')
  })

  it('lets the Owner filter by professional, in the URL', async () => {
    const { router, user } = await renderAgenda()
    await dayList()

    await choose(user, 'Profissional', 'Bruno Lima')

    await waitFor(() => expect(where(router)).toBe(`/painel?profissional=${BRUNO_ID}`))
    await waitFor(() => expect(teamApi.agendaRequests.at(-1)?.get('professional_id')).toBe(BRUNO_ID))
    const list = await dayList()
    await waitFor(() => expect(list.queryByRole('button', { name: /Carlos Dias/ })).not.toBeInTheDocument())
    expect(list.getByRole('button', { name: /Diego Rocha/ })).not.toHaveTextContent('com Bruno Lima')
    // A former professional is not in the filter.
    await user.click(screen.getByRole('combobox', { name: 'Profissional' }))
    expect(screen.queryByRole('option', { name: 'Carla Souza' })).not.toBeInTheDocument()
  })

  it('ignores an unknown professional in the URL', async () => {
    await renderAgenda('/painel?profissional=nao-existe')

    expect((await dayList()).getByRole('button', { name: /Carlos Dias/ })).toBeInTheDocument()
    expect(teamApi.agendaRequests.every((query) => !query.has('professional_id'))).toBe(true)
  })

  it('shows a Professional only the own agenda, without the filter', async () => {
    await renderAgenda('/painel', 'professional')

    const list = await dayList()
    expect(list.getAllByRole('button')).toHaveLength(2)
    expect(list.getByRole('button', { name: /Diego Rocha/ })).not.toHaveTextContent('com Bruno')
    expect(screen.queryByRole('combobox', { name: 'Profissional' })).not.toBeInTheDocument()
    expect(teamApi.agendaRequests[0].has('professional_id')).toBe(false)
  })

  it('offers a retry when the agenda could not be read', async () => {
    let calls = 0
    server.use(
      http.get(`${API}/appointments`, () => {
        calls += 1
        return calls === 1 ? HttpResponse.error() : HttpResponse.json([])
      }),
    )
    const { user } = await renderAgenda()

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar a agenda')
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('Nenhum agendamento neste dia')).toBeInTheDocument()
  })
})

describe('desktop grid (D80)', () => {
  beforeEach(asDesktop)

  it('has one column per professional for the Owner, and the week in a tab', async () => {
    const { router, user } = await renderAgenda()

    const grid = within(await screen.findByRole('region', { name: 'Grade de quinta-feira, 12/11/2026' }))
    expect(grid.getByRole('list', { name: 'Dona Ana' })).toBeInTheDocument()
    expect(grid.getByRole('list', { name: 'Bruno Lima' })).toBeInTheDocument()
    expect(grid.queryByRole('list', { name: 'Carla Souza' })).not.toBeInTheDocument()
    expect(
      grid.getByRole('button', {
        name: '11:00–11:30, Corte, Diego Rocha, com Bruno Lima, Confirmado, resultado a registrar',
      }),
    ).toBeInTheDocument()
    // The cancelled take no time: out of the grid, below it.
    expect(grid.queryByRole('button', { name: /Gabi Lopes/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelados (1)' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Semana' }))
    const week = within(await screen.findByRole('region', { name: 'Grade da semana de 09/11 a 15/11/2026' }))
    expect(where(router)).toBe('/painel?visao=semana')
    expect(week.getByRole('button', { name: /Helena Reis/ })).toBeInTheDocument()
    expect(week.getByText('1 cancelado')).toBeInTheDocument()
    expect(teamApi.agendaRequests).toHaveLength(1)

    await user.click(week.getByRole('button', { name: 'Ver o dia sexta-feira, 13/11/2026' }))
    expect(await screen.findByRole('region', { name: 'Grade de sexta-feira, 13/11/2026' })).toBeInTheDocument()
    expect(where(router)).toBe('/painel?dia=2026-11-13')

    await user.click(screen.getByRole('button', { name: 'Próximo dia' }))
    expect(await screen.findByText('Nenhum agendamento neste dia')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Semana' }))
    await user.click(await screen.findByRole('button', { name: 'Próxima semana' }))
    await waitFor(() => expect(teamApi.agendaRequests).toHaveLength(2))
  })

  it('has a single column for a Professional, and opens a block in the sheet', async () => {
    const { user } = await renderAgenda('/painel', 'professional')

    const grid = within(await screen.findByRole('region', { name: 'Grade de quinta-feira, 12/11/2026' }))
    expect(grid.getAllByRole('list')).toHaveLength(1)
    await user.click(grid.getByRole('button', { name: /Elisa Prado/ }))

    const sheet = within(await screen.findByRole('dialog', { name: 'Corte' }))
    expect(sheet.getByText('Quinta-feira, 12/11/2026, 14:00–14:30')).toBeInTheDocument()
  })
})

describe('manual appointment (UC16)', () => {
  it('books any minute for the chosen professional, with only the name', async () => {
    const { user } = await renderAgenda()
    await dayList()

    await user.click(screen.getByRole('button', { name: 'Novo' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Novo agendamento' }))
    await choose(user, 'Profissional', 'Bruno Lima')
    await choose(user, 'Serviço', 'Corte')
    // The working hours and the free ranges, from now on (13:00), around Elisa at 14:00.
    expect(await sheet.findByText('09:00–12:00 e 13:00–19:00')).toBeInTheDocument()
    expect(sheet.getByRole('button', { name: 'Usar 13:01, livre até 14:00' })).toBeInTheDocument()
    await user.click(sheet.getByRole('button', { name: 'Usar 14:40, livre até 19:00' }))
    expect(sheet.getByLabelText('Hora')).toHaveValue('14:40')
    await user.type(sheet.getByLabelText('Nome do cliente'), 'Ivo Matos')
    await user.click(sheet.getByRole('button', { name: 'Criar agendamento' }))

    const title = await sheet.findByRole('heading', { name: 'Agendamento criado' })
    await waitFor(() => expect(title).toHaveFocus())
    expect(teamApi.bodies).toEqual([
      {
        professional_id: BRUNO_ID,
        service_id: expect.any(String),
        starts_at: '2026-11-12T17:40:00Z',
        customer: { name: 'Ivo Matos', email: null, phone: null },
      },
    ])
    expect(sheet.getByText(/Sem e-mail, o cliente não recebe link/)).toBeInTheDocument()
    expect(sheet.queryByLabelText('Link do cliente')).not.toBeInTheDocument()

    await user.click(sheet.getByRole('button', { name: 'Ver na agenda' }))
    expect(await (await dayList()).findByRole('button', { name: /Ivo Matos/ })).toBeInTheDocument()
  })

  it('shows the link with the copy button when the customer has an e-mail', async () => {
    const { user } = await renderAgenda('/painel', 'professional')
    await dayList()

    await user.click(screen.getByRole('button', { name: 'Novo' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Novo agendamento' }))
    // A Professional books only in the own agenda.
    expect(sheet.queryByRole('combobox', { name: 'Profissional' })).not.toBeInTheDocument()
    expect(sheet.getByText('Bruno Lima')).toBeInTheDocument()
    await choose(user, 'Serviço', 'Corte')
    await user.type(sheet.getByLabelText('Hora'), '16:05')
    await user.type(sheet.getByLabelText('Nome do cliente'), 'Joana Lins')
    await user.type(sheet.getByLabelText('E-mail (opcional)'), 'joana@exemplo.com')
    await user.type(sheet.getByLabelText('Telefone (opcional)'), '(11) 98765-4321')
    await user.click(sheet.getByRole('button', { name: 'Criar agendamento' }))

    expect(await sheet.findByLabelText('Link do cliente')).toHaveValue(
      'https://app.exemplo.com/agendamento/token-novo',
    )
    expect(sheet.getByRole('button', { name: 'Copiar link' })).toBeInTheDocument()
    expect(teamApi.bodies[0]).toMatchObject({
      customer: { name: 'Joana Lins', email: 'joana@exemplo.com', phone: '+5511987654321' },
    })
  })

  it('tells a past time and one out of the working hours before sending', async () => {
    const { user } = await renderAgenda('/painel', 'professional')
    await dayList()

    await user.click(screen.getByRole('button', { name: 'Novo' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Novo agendamento' }))
    await user.click(sheet.getByRole('button', { name: 'Criar agendamento' }))
    expect(await sheet.findByText('Escolha o serviço.')).toBeInTheDocument()
    expect(sheet.getByText('Informe a hora, como 09:30.')).toBeInTheDocument()
    expect(sheet.getByText('Informe o nome do cliente.')).toBeInTheDocument()

    await choose(user, 'Serviço', 'Corte')
    await user.type(sheet.getByLabelText('Hora'), '12:30')
    expect(await sheet.findByText('Este horário já passou.')).toBeInTheDocument()

    await user.clear(sheet.getByLabelText('Hora'))
    await user.type(sheet.getByLabelText('Hora'), '18:30')
    expect(
      await sheet.findByText(
        'Fora do expediente de Bruno Lima. Os 30 min do atendimento, mais 10 min de preparo, precisam caber inteiros em 09:00–12:00 e 13:00–19:00.',
      ),
    ).toBeInTheDocument()
    await user.type(sheet.getByLabelText('Nome do cliente'), 'Ivo Matos')
    await user.click(sheet.getByRole('button', { name: 'Criar agendamento' }))
    expect(sheet.getByLabelText('Hora')).toHaveFocus()
    expect(teamApi.calls.create).toBe(0)
  })

  it('explains a 409 by its reason and keeps what was typed (D83)', async () => {
    server.use(http.post(`${API}/appointments`, () => slotRefused('blocked')))
    const { user } = await renderAgenda('/painel', 'professional')
    await dayList()

    await user.click(screen.getByRole('button', { name: 'Novo' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Novo agendamento' }))
    await choose(user, 'Serviço', 'Corte')
    await user.type(sheet.getByLabelText('Hora'), '16:00')
    await user.type(sheet.getByLabelText('Nome do cliente'), 'Ivo Matos')
    await user.click(sheet.getByRole('button', { name: 'Criar agendamento' }))

    expect(await sheet.findByRole('alert')).toHaveTextContent(
      'Este horário cai num bloqueio de Bruno Lima. Escolha outro horário.',
    )
    expect(sheet.getByLabelText('Nome do cliente')).toHaveValue('Ivo Matos')
    await waitFor(() => expect(sheet.getByLabelText('Hora')).toHaveFocus())

    // Another time clears the refusal.
    await user.clear(sheet.getByLabelText('Hora'))
    expect(sheet.queryByText(/cai num bloqueio/)).not.toBeInTheDocument()
  })

  it('maps a refused field of the customer to the form', async () => {
    server.use(
      http.post(`${API}/appointments`, () =>
        problem(422, 'VALIDATION_ERROR', {
          errors: [{ loc: ['body', 'customer', 'phone'], msg: 'String should match pattern', type: 'string_pattern_mismatch' }],
        }),
      ),
    )
    const { user } = await renderAgenda('/painel', 'professional')
    await dayList()

    await user.click(screen.getByRole('button', { name: 'Novo' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Novo agendamento' }))
    await choose(user, 'Serviço', 'Corte')
    await user.type(sheet.getByLabelText('Hora'), '16:00')
    await user.type(sheet.getByLabelText('Nome do cliente'), 'Ivo Matos')
    await user.type(sheet.getByLabelText('Telefone (opcional)'), '+1 415 555 0100')
    await user.click(sheet.getByRole('button', { name: 'Criar agendamento' }))

    expect(await sheet.findByText('Informe o telefone com DDD, como (11) 98765-4321.')).toBeInTheDocument()
    expect(sheet.getByLabelText('Telefone (opcional)')).toHaveFocus()
  })
})

describe('cancel and reschedule (UC17)', () => {
  it('cancels only after the confirmation, and tells the customer had no e-mail', async () => {
    const { user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Elisa Prado')
    await user.click(sheet.getByRole('button', { name: 'Cancelar agendamento' }))
    const dialog = within(await screen.findByRole('alertdialog', { name: 'Cancelar este agendamento?' }))
    expect(dialog.getByRole('button', { name: 'Manter agendamento' })).toHaveFocus()
    expect(dialog.getByText(/avise o cliente por outro meio/)).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(teamApi.calls.cancel).toBe(0)

    await user.click(sheet.getByRole('button', { name: 'Cancelar agendamento' }))
    const again = within(await screen.findByRole('alertdialog'))
    await user.dblClick(again.getByRole('button', { name: 'Cancelar agendamento' }))

    const notice = await sheet.findByRole('status')
    await waitFor(() => expect(notice).toHaveTextContent('Agendamento cancelado'))
    expect(notice).toHaveTextContent('O agendamento não tem e-mail: avise o cliente por outro meio.')
    await waitFor(() => expect(notice).toHaveFocus())
    expect(teamApi.calls.cancel).toBe(1)
    expect(sheet.getByText('Cancelado')).toBeInTheDocument()
    expect(sheet.queryByRole('button', { name: 'Remarcar' })).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: 'Cancelados (2)' })).toBeInTheDocument()
  })

  it('reads the agenda again when the status changed elsewhere', async () => {
    server.use(http.post(`${API}/appointments/:id/cancel`, () => problem(409, 'INVALID_STATUS_TRANSITION')))
    const { user } = await renderAgenda()
    await dayList()
    const before = teamApi.agendaRequests.length

    const sheet = await openCard(user, 'Elisa Prado')
    await user.click(sheet.getByRole('button', { name: 'Cancelar agendamento' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar agendamento' }))

    expect(await sheet.findByText('Não foi possível cancelar')).toBeInTheDocument()
    expect(sheet.getByText(/não permite esta ação agora/)).toBeInTheDocument()
    await waitFor(() => expect(teamApi.agendaRequests.length).toBeGreaterThan(before))
  })

  it('keeps a network failure inside the dialog', async () => {
    server.use(http.post(`${API}/appointments/:id/cancel`, () => HttpResponse.error()))
    const { user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Elisa Prado')
    await user.click(sheet.getByRole('button', { name: 'Cancelar agendamento' }))
    const dialog = within(await screen.findByRole('alertdialog'))
    await user.click(dialog.getByRole('button', { name: 'Cancelar agendamento' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('Não foi possível cancelar')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('reschedules to another day and moves the agenda there', async () => {
    const { router, user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Elisa Prado')
    await user.click(sheet.getByRole('button', { name: 'Remarcar' }))
    const form = within(await sheet.findByRole('form', { name: 'Remarcar' }))
    await waitFor(() => expect(form.getByLabelText('Hora')).toHaveFocus())
    // The Owner may move it to another professional who does the service.
    expect(form.getByRole('combobox', { name: 'Profissional' })).toHaveTextContent('Bruno Lima')
    await user.clear(form.getByLabelText('Dia'))
    await user.type(form.getByLabelText('Dia'), '2026-11-13')
    await user.type(form.getByLabelText('Hora'), '09:30')
    await user.click(form.getByRole('button', { name: 'Remarcar para 09:30' }))

    const notice = await sheet.findByRole('status')
    await waitFor(() => expect(notice).toHaveTextContent('Remarcado para sexta-feira, 13/11/2026 às 09:30'))
    expect(notice).toHaveTextContent('O agendamento não tem e-mail: avise o cliente do novo horário')
    expect(teamApi.bodies).toEqual([{ starts_at: '2026-11-13T12:30:00Z' }])
    await waitFor(() => expect(where(router)).toBe('/painel?dia=2026-11-13'))
  })

  it('keeps the choice open on a slot refusal, with the reason (D83)', async () => {
    server.use(
      http.post(`${API}/appointments/:id/reschedule`, () => slotRefused('appointment_conflict')),
    )
    const { user } = await renderAgenda('/painel', 'professional')
    await dayList()

    const sheet = await openCard(user, 'Elisa Prado')
    await user.click(sheet.getByRole('button', { name: 'Remarcar' }))
    const form = within(await sheet.findByRole('form', { name: 'Remarcar' }))
    expect(form.queryByRole('combobox', { name: 'Profissional' })).not.toBeInTheDocument()
    await user.type(form.getByLabelText('Hora'), '16:00')
    await user.click(form.getByRole('button', { name: 'Remarcar para 16:00' }))

    expect(await form.findByRole('alert')).toHaveTextContent(
      'Este horário coincide com outro agendamento de Bruno Lima. Escolha outro horário.',
    )
    expect(sheet.getByRole('form', { name: 'Remarcar' })).toBeInTheDocument()

    await user.click(form.getByRole('button', { name: 'Manter horário atual' }))
    await waitFor(() => expect(sheet.getByRole('button', { name: 'Remarcar' })).toHaveFocus())
  })

  it('reads the appointment again and closes the reschedule when it changed meanwhile (D83)', async () => {
    server.use(
      http.post(`${API}/appointments/:id/reschedule`, () => {
        // Someone else moved it to Dona Ana while this request waited.
        const current = teamApi.find(APPOINTMENT_IDS.next)!
        teamApi.replace({ ...current, professional_id: '9a0c1e2f-0000-4000-8000-00000000000a' })
        return slotRefused('changed_meanwhile')
      }),
    )
    const { user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Elisa Prado')
    expect(sheet.getByText('Bruno Lima')).toBeInTheDocument()
    await user.click(sheet.getByRole('button', { name: 'Remarcar' }))
    const form = within(await sheet.findByRole('form', { name: 'Remarcar' }))
    await user.type(form.getByLabelText('Hora'), '16:00')
    await user.click(form.getByRole('button', { name: 'Remarcar para 16:00' }))

    const notice = await sheet.findByRole('status')
    await waitFor(() => expect(notice).toHaveTextContent('O agendamento mudou'))
    expect(notice).toHaveTextContent('Outra pessoa alterou este agendamento enquanto você remarcava.')
    expect(sheet.queryByRole('form', { name: 'Remarcar' })).not.toBeInTheDocument()
    expect(await sheet.findByText('Dona Ana')).toBeInTheDocument()
  })
})

describe('result of the appointment (UC18)', () => {
  it('waits for the start before offering the result (RN15)', async () => {
    const { user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Elisa Prado')
    expect(sheet.getByText('O resultado do atendimento pode ser registrado a partir das 14:00.')).toBeInTheDocument()
    expect(sheet.queryByRole('button', { name: 'Concluído' })).not.toBeInTheDocument()
  })

  it('names the day when the start is on another day', async () => {
    const { user } = await renderAgenda('/painel?dia=2026-11-13')
    await dayList()

    const sheet = await openCard(user, 'Helena Reis')
    expect(
      sheet.getByText('O resultado do atendimento pode ser registrado a partir de sexta-feira, 13/11/2026 às 10:00.'),
    ).toBeInTheDocument()
  })

  it('records "Concluído" at once, from the start on', async () => {
    const { user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Diego Rocha')
    // The sheet takes the focus itself: a stray Enter never records a result.
    expect(sheet.getByRole('button', { name: 'Concluído' })).not.toHaveFocus()
    await user.click(sheet.getByRole('button', { name: 'Concluído' }))

    const notice = await sheet.findByRole('status')
    await waitFor(() => expect(notice).toHaveTextContent('Atendimento concluído'))
    expect(teamApi.calls.complete).toBe(1)
    expect(sheet.getByText('Situação final: este agendamento não pode mais ser alterado.')).toBeInTheDocument()
  })

  it('asks before recording a no-show', async () => {
    const { user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Diego Rocha')
    await user.click(sheet.getByRole('button', { name: 'Não compareceu' }))
    const dialog = within(
      await screen.findByRole('alertdialog', { name: 'Registrar que Diego Rocha não compareceu?' }),
    )
    expect(dialog.getByRole('button', { name: 'Voltar' })).toHaveFocus()
    await user.click(dialog.getByRole('button', { name: 'Registrar não comparecimento' }))

    const notice = await sheet.findByRole('status')
    await waitFor(() => expect(notice).toHaveTextContent('Não comparecimento registrado'))
    expect(teamApi.calls.noShow).toBe(1)
    expect(sheet.getByText('Não compareceu')).toBeInTheDocument()
  })

  it('tells a refused result and reads the agenda again', async () => {
    server.use(http.post(`${API}/appointments/:id/complete`, () => problem(409, 'INVALID_STATUS_TRANSITION')))
    const { user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Diego Rocha')
    await user.click(sheet.getByRole('button', { name: 'Concluído' }))

    expect(await sheet.findByText('Não foi possível registrar')).toBeInTheDocument()
  })

  it('keeps a failure next to the buttons', async () => {
    server.use(http.post(`${API}/appointments/:id/complete`, () => HttpResponse.error()))
    const { user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Diego Rocha')
    await user.click(sheet.getByRole('button', { name: 'Concluído' }))

    expect(await sheet.findByRole('alert')).toHaveTextContent('Não foi possível registrar')
    expect(sheet.getByRole('button', { name: 'Concluído' })).toBeEnabled()
  })

  it('shows a final status without actions', async () => {
    const { user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Carlos Dias')
    expect(sheet.getByText('Concluído')).toBeInTheDocument()
    expect(sheet.getByText('Situação final: este agendamento não pode mais ser alterado.')).toBeInTheDocument()
    for (const name of ['Concluído', 'Não compareceu', 'Remarcar', 'Cancelar agendamento']) {
      expect(sheet.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('opens a cancelled one from its group', async () => {
    const { user } = await renderAgenda()
    await dayList()

    await user.click(screen.getByRole('button', { name: 'Cancelados (1)' }))
    const cancelled = within(await screen.findByRole('list', { name: 'Cancelados do dia' }))
    await user.click(cancelled.getByRole('button', { name: /Gabi Lopes/ }))
    const sheet = within(await screen.findByRole('dialog'))
    expect(sheet.getByText('Cancelado')).toBeInTheDocument()
    expect(sheet.getByRole('link', { name: '+5511999999999' })).toHaveAttribute('href', 'tel:+5511999999999')
  })
})

describe('focus (D84)', () => {
  it('goes back to the card and to "Novo" when the sheets close', async () => {
    const { user } = await renderAgenda()
    await dayList()

    const card = screen.getByRole('button', { name: /Elisa Prado/ })
    await user.click(card)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(card).toHaveFocus())

    const create = screen.getByRole('button', { name: 'Novo' })
    await user.click(create)
    await screen.findByRole('dialog', { name: 'Novo agendamento' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(create).toHaveFocus())
  })

  it('goes to the moved appointment, or to the title, when the opener is gone', async () => {
    const { user } = await renderAgenda()
    await dayList()

    const sheet = await openCard(user, 'Elisa Prado')
    await user.click(sheet.getByRole('button', { name: 'Cancelar agendamento' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar agendamento' }))
    await waitFor(() => expect(sheet.getByRole('status')).toHaveTextContent('Agendamento cancelado'))
    await user.keyboard('{Escape}')

    // The card left the list for the closed group of the cancelled: the title takes the focus.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toHaveFocus())
  })
})

describe('agenda edges', () => {
  it('waits for the day with only cancellations', async () => {
    teamApi.appointments = [
      staffAppointment({ id: 'x', local: '2026-11-12T16:00', status: 'cancelled', customer_name: 'Lia' }),
    ]
    await renderAgenda()

    expect(await screen.findByText('Só cancelamentos neste dia')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelados (1)' })).toBeInTheDocument()
  })

  it('tells when nobody can take an appointment', async () => {
    server.use(http.get(`${API}/services`, () => HttpResponse.json([])))
    const { user } = await renderAgenda()
    await dayList()

    await user.click(screen.getByRole('button', { name: 'Novo' }))
    expect(
      await screen.findByText(/Nenhum profissional pode receber agendamentos agora/),
    ).toBeInTheDocument()
  })
})
