import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { components } from '@/api/schema'
import { createQueryClient } from '@/api/query-client'
import { Providers } from '@/app/providers'
import { routes } from '@/app/router'
import { teamKeys } from '@/features/scheduling'
import { meOf } from '@/test/msw/auth'
import { API, problem } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'
import { ANA_ID, BRUNO_ID, CORTE_ID, teamApi } from '@/test/msw/team-agenda'
import { scheduleApi } from '@/test/msw/work-schedule'
import { withOpenSession } from '@/test/session'

// 13:00 of Thursday, 12/11/2026 in São Paulo; already Friday, 01:00, in Tokyo (D56).
const NOW = new Date('2026-11-12T16:00:00Z')

type Role = 'owner' | 'professional'
type Scheduled = components['schemas']['AppointmentData']

async function renderPage(path: string, role: Role = 'owner', heading = 'Expediente') {
  await withOpenSession(role)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  const queryClient = createQueryClient({ queries: { retry: false } })
  render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  )
  // The first opening of the panel in each test: its group is loaded on demand (D54) and, cold and
  // under the load of the whole suite, takes longer than the default wait of setup.ts.
  await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 10_000 })
  return { router, user, queryClient }
}

const where = (router: Awaited<ReturnType<typeof renderPage>>['router']) =>
  `${router.state.location.pathname}${router.state.location.search}`

/** One day of the week editor, by its name. */
async function day(name: string) {
  return within(await screen.findByRole('listitem', { name }))
}

/** The summary below the name of a day, whose ranges are split in spans that never wrap. */
const summary = (text: string) => (_: string, element: Element | null) =>
  element?.tagName === 'P' && element.textContent === text

const save = () => screen.getByRole('button', { name: /Salvar expediente/ })

/** An appointment in the format of `conflicts` and `appointments_outside_hours`, at a time of São Paulo. */
function scheduled(id: string, local: string, overrides: Partial<Scheduled> = {}): Scheduled {
  const start = Date.parse(`${local}:00-03:00`)
  const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')
  return {
    id,
    professional_id: BRUNO_ID,
    service_id: CORTE_ID,
    starts_at: iso(start),
    ends_at: iso(start + 30 * 60_000),
    blocked_until: iso(start + 40 * 60_000),
    status: 'confirmed',
    customer_name: 'Elisa Prado',
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('working hours (UC08)', () => {
  it('opens the own week of the Owner, with a picker of the active team (D74)', async () => {
    const { router, user } = await renderPage('/painel/expediente')

    expect(await screen.findByRole('combobox', { name: 'Profissional' })).toHaveTextContent('Dona Ana (você)')
    expect(screen.getByText(/Horários no fuso do negócio \(São Paulo e Brasília\)/)).toBeInTheDocument()
    expect((await day('Segunda-feira')).getByText(summary('09:00–12:00 e 13:00–19:00'))).toBeInTheDocument()
    expect((await day('Domingo')).getByText('Fechado')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Profissional' }))
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['Dona Ana (você)', 'Bruno Lima'])
    await user.click(screen.getByRole('option', { name: 'Bruno Lima' }))
    expect(where(router)).toBe(`/painel/expediente?profissional=${BRUNO_ID}`)
  })

  it('gives a Professional only the own week, with no picker', async () => {
    const { user } = await renderPage('/painel/expediente', 'professional')
    const sunday = await day('Domingo')
    expect(screen.queryByRole('combobox', { name: 'Profissional' })).not.toBeInTheDocument()

    await user.click(sunday.getByRole('button', { name: /Abrir este dia/ }))
    await user.click(save())

    await screen.findByText('Expediente salvo. Nenhum agendamento ficou fora dele.')
    expect(scheduleApi.puts).toHaveLength(1)
    expect(scheduleApi.hours.has(BRUNO_ID)).toBe(true)
  })

  it('saves a lunch break as two intervals on the same day, and replaces the whole week', async () => {
    const { user } = await renderPage('/painel/expediente')
    const sunday = await day('Domingo')

    await user.click(sunday.getByRole('button', { name: /Abrir este dia/ }))
    const end = sunday.getByLabelText('Fim do intervalo 1 de domingo')
    await user.clear(end)
    await user.type(end, '12:00')
    await user.click(sunday.getByRole('button', { name: /Adicionar intervalo/ }))
    expect(sunday.getByLabelText('Início do intervalo 2 de domingo')).toHaveValue('13:00')
    expect(sunday.getByLabelText('Fim do intervalo 2 de domingo')).toHaveValue('17:00')
    expect(screen.getByText('Alterações não salvas.')).toBeInTheDocument()
    await user.click(save())

    const notice = await screen.findByText('Expediente salvo. Nenhum agendamento ficou fora dele.')
    await waitFor(() => expect(notice.closest('[tabindex="-1"]')).toHaveFocus())
    const [body] = scheduleApi.puts
    expect(body.filter((item) => item.weekday === 6)).toEqual([
      { weekday: 6, start_time: '09:00', end_time: '12:00' },
      { weekday: 6, start_time: '13:00', end_time: '17:00' },
    ])
    // The PUT replaces everything: the other six days go too.
    expect(body).toHaveLength(14)
    expect(save()).toBeDisabled()
  })

  it('refuses an end before the start before sending, on the field', async () => {
    const { user } = await renderPage('/painel/expediente')
    const monday = await day('Segunda-feira')

    const end = monday.getByLabelText('Fim do intervalo 1 de segunda-feira')
    await user.clear(end)
    await user.type(end, '08:00')
    await user.click(save())

    const summary = await screen.findByRole('region', { name: 'Corrija um horário antes de salvar' })
    await waitFor(() => expect(summary).toHaveFocus())
    expect(scheduleApi.puts).toHaveLength(0)
    expect(end).toHaveAttribute('aria-invalid', 'true')
    expect(end).toHaveAccessibleDescription('O fim precisa ser depois do início (09:00).')

    await user.click(within(summary).getByRole('link', { name: /Segunda-feira: O fim precisa/ }))
    expect(end).toHaveFocus()
  })

  it('refuses overlapping intervals before sending', async () => {
    const { user } = await renderPage('/painel/expediente')
    const monday = await day('Segunda-feira')

    const start = monday.getByLabelText('Início do intervalo 2 de segunda-feira')
    await user.clear(start)
    await user.type(start, '11:00')
    // Shown when leaving the field, before any save.
    await user.tab()
    expect(start).toHaveAccessibleDescription('Sobrepõe o intervalo 09:00–12:00. Comece às 12:00 ou depois.')
    await user.click(save())

    expect(await screen.findByRole('region', { name: 'Corrija um horário antes de salvar' })).toBeInTheDocument()
    expect(scheduleApi.puts).toHaveLength(0)
  })

  it('copies the intervals of a day to others', async () => {
    const { user } = await renderPage('/painel/expediente')
    const monday = await day('Segunda-feira')

    await user.click(monday.getByRole('button', { name: 'Copiar para…' }))
    const panel = within(monday.getByRole('group', { name: /Copiar 09:00–12:00 e 13:00–19:00 de segunda-feira para/ }))
    expect(panel.queryByRole('checkbox', { name: 'Segunda' })).not.toBeInTheDocument()
    expect(panel.getByRole('checkbox', { name: 'Terça' })).not.toBeChecked()
    expect(panel.getByRole('button', { name: 'Copiar' })).toBeDisabled()
    await user.click(panel.getByRole('checkbox', { name: 'Domingo' }))
    await user.click(panel.getByRole('button', { name: 'Copiar para 1 dia' }))

    expect(monday.getByRole('button', { name: 'Copiar para…' })).toHaveFocus()
    expect(
      screen.getByText('Expediente de segunda-feira copiado para domingo. Salve para valer.'),
    ).toBeInTheDocument()
    expect((await day('Domingo')).getByText(summary('09:00–12:00 e 13:00–19:00'))).toBeInTheDocument()
    await user.click(save())

    await screen.findByText('Expediente salvo. Nenhum agendamento ficou fora dele.')
    expect(scheduleApi.puts[0].filter((item) => item.weekday === 6)).toEqual([
      { weekday: 6, start_time: '09:00', end_time: '12:00' },
      { weekday: 6, start_time: '13:00', end_time: '19:00' },
    ])
  })

  it('lists the appointments left outside, which stay booked, with links to their days', async () => {
    scheduleApi.outside = [scheduled('a1', '2026-11-19T18:30')]
    const { user } = await renderPage(`/painel/expediente?profissional=${BRUNO_ID}`)
    const thursday = await day('Quinta-feira')

    const end = thursday.getByLabelText('Fim do intervalo 2 de quinta-feira')
    await user.clear(end)
    await user.type(end, '18:00')
    await user.click(save())

    expect(await screen.findByText('Expediente salvo. 1 agendamento ficou fora dele')).toBeInTheDocument()
    expect(screen.getByText(/Ele continua marcado: o novo expediente vale para as próximas reservas/)).toBeInTheDocument()
    const list = within(screen.getByRole('list', { name: 'Agendamentos fora do novo expediente' }))
    const link = list.getByRole('link', {
      name: 'quinta-feira, 19/11/2026, 18:30–19:00, Corte, Elisa Prado. Ver na agenda',
    })
    expect(link).toHaveAttribute('href', `/painel?dia=2026-11-19&profissional=${BRUNO_ID}`)
  })

  it('links a Professional to the own agenda, without the filter', async () => {
    scheduleApi.outside = [scheduled('a1', '2026-11-19T18:30')]
    const { user } = await renderPage('/painel/expediente', 'professional')
    const thursday = await day('Quinta-feira')
    await user.click(thursday.getByRole('button', { name: 'Remover intervalo 2 de quinta-feira' }))
    expect(thursday.getByLabelText('Início do intervalo 1 de quinta-feira')).toHaveFocus()
    await user.click(save())

    const link = await screen.findByRole('link', { name: /19\/11\/2026, 18:30–19:00/ })
    expect(link).toHaveAttribute('href', '/painel?dia=2026-11-19')
  })

  it('invalidates the agenda, the working hours and the blocks after saving', async () => {
    const { user, queryClient } = await renderPage('/painel/expediente')
    queryClient.setQueryData(teamKeys.agenda('2026-11-09', null), [])
    queryClient.setQueryData(teamKeys.timeBlocks(ANA_ID), [])
    const sunday = await day('Domingo')

    await user.click(sunday.getByRole('button', { name: /Abrir este dia/ }))
    await user.click(save())
    await screen.findByText('Expediente salvo. Nenhum agendamento ficou fora dele.')

    await waitFor(() => {
      expect(queryClient.getQueryState(teamKeys.agenda('2026-11-09', null))?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(teamKeys.timeBlocks(ANA_ID))?.isInvalidated).toBe(true)
    })
    expect(queryClient.getQueryData(teamKeys.workingHours(ANA_ID))).toEqual({ intervals: scheduleApi.puts[0] })
  })

  it('asks before throwing away unsaved changes when the Owner switches professional', async () => {
    const { router, user } = await renderPage('/painel/expediente')
    const sunday = await day('Domingo')
    await user.click(sunday.getByRole('button', { name: /Abrir este dia/ }))

    const pick = async () => {
      await user.click(screen.getByRole('combobox', { name: 'Profissional' }))
      await user.click(await screen.findByRole('option', { name: 'Bruno Lima' }))
      return within(await screen.findByRole('alertdialog', { name: 'Descartar as alterações?' }))
    }

    let dialog = await pick()
    expect(dialog.getByRole('button', { name: 'Continuar editando' })).toHaveFocus()
    await user.click(dialog.getByRole('button', { name: 'Continuar editando' }))
    expect(where(router)).toBe('/painel/expediente')
    expect((await day('Domingo')).getByText('09:00–18:00')).toBeInTheDocument()

    dialog = await pick()
    await user.click(dialog.getByRole('button', { name: 'Descartar e trocar' }))
    expect(where(router)).toBe(`/painel/expediente?profissional=${BRUNO_ID}`)
    // The navigation commits in a transition: the other week comes after it.
    await waitFor(() =>
      expect(within(screen.getByRole('listitem', { name: 'Domingo' })).getByText('Fechado')).toBeInTheDocument(),
    )
  })

  it('tells a failed save and keeps the edits', async () => {
    server.use(http.put(`${API}/professionals/:id/working-hours`, () => problem(500, 'INTERNAL_ERROR')))
    const { user } = await renderPage('/painel/expediente')
    const sunday = await day('Domingo')
    await user.click(sunday.getByRole('button', { name: /Abrir este dia/ }))
    await user.click(save())

    expect(await screen.findByText('Não foi possível salvar o expediente')).toBeInTheDocument()
    expect(sunday.getByText('09:00–18:00')).toBeInTheDocument()
    expect(save()).toBeEnabled()
  })

  it('tells a failed read, with a new attempt', async () => {
    let fail = true
    server.use(
      http.get(`${API}/professionals/:id/working-hours`, () =>
        fail ? problem(500, 'INTERNAL_ERROR') : HttpResponse.json({ intervals: [] }),
      ),
    )
    const { user } = await renderPage('/painel/expediente')
    expect(await screen.findByText('Não foi possível carregar o expediente')).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect((await day('Segunda-feira')).getByText('Fechado')).toBeInTheDocument()
  })
})

/** Fills a native date or time field. */
async function fill(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const field = screen.getByLabelText(label)
  await user.clear(field)
  if (value !== '') await user.type(field, value)
}

async function typeBlock(
  user: ReturnType<typeof userEvent.setup>,
  { day: start, from, to, reason }: { day: string; from: string; to: string; reason: string },
) {
  await fill(user, 'Início', start)
  await fill(user, 'Hora do início', from)
  await fill(user, 'Hora do fim', to)
  await user.type(screen.getByLabelText('Motivo'), reason)
}

const blockButton = () => screen.getByRole('button', { name: /Bloquear horário/ })

describe('blocks (UC09)', () => {
  it('creates a block in the clock of the business, sent in UTC', async () => {
    const { user, queryClient } = await renderPage('/painel/bloqueios', 'professional', 'Bloqueios')
    expect(await screen.findByText('Nenhum bloqueio pela frente')).toBeInTheDocument()
    queryClient.setQueryData(teamKeys.agenda('2026-11-09', null), [])

    // Today in São Paulo, not in Tokyo (already Friday there).
    expect(screen.getByLabelText('Início')).toHaveValue('2026-11-12')
    await typeBlock(user, { day: '2026-11-14', from: '09:00', to: '12:00', reason: 'Consulta médica' })
    expect(screen.getByLabelText('Fim')).toHaveValue('2026-11-14')
    await user.click(blockButton())

    const notice = await screen.findByText('Bloqueio criado: Sábado, 14/11/2026, 09:00–12:00.')
    await waitFor(() => expect(notice.closest('[tabindex="-1"]')).toHaveFocus())
    expect(scheduleApi.blockBodies).toEqual([
      { starts_at: '2026-11-14T12:00:00Z', ends_at: '2026-11-14T15:00:00Z', reason: 'Consulta médica' },
    ])
    const list = within(await screen.findByRole('list', { name: /Próximos bloqueios/ }))
    expect(list.getByText('sábado, 14/11/2026')).toBeInTheDocument()
    expect(list.getByText('Consulta médica')).toBeInTheDocument()
    expect(screen.getByLabelText('Motivo')).toHaveValue('')
    // The manual booking of the agenda reads the blocks (D82).
    await waitFor(() =>
      expect(queryClient.getQueryState(teamKeys.agenda('2026-11-09', null))?.isInvalidated).toBe(true),
    )
  })

  it('handles the days the clock changes, in the time zone of the business', async () => {
    server.use(
      http.get(`${API}/auth/me`, () => {
        const me = meOf('professional')
        return HttpResponse.json({ ...me, business: { ...me.business, timezone: 'America/New_York' } })
      }),
    )
    const { user } = await renderPage('/painel/bloqueios', 'professional', 'Bloqueios')
    await screen.findByText('Nenhum bloqueio pela frente')

    // 14/03/2027 in New York: from 01:59 straight to 03:00.
    await typeBlock(user, { day: '2027-03-14', from: '02:30', to: '05:00', reason: 'Folga' })
    await user.click(blockButton())
    expect(screen.getByLabelText('Hora do início')).toHaveFocus()
    expect(screen.getByLabelText('Hora do início')).toHaveAccessibleDescription(
      '02:30 não existe em domingo, 14/03/2027: o relógio pula essa hora na mudança de horário. Escolha outro horário.',
    )
    expect(scheduleApi.blockBodies).toHaveLength(0)

    // A whole day has 23 hours there.
    await user.click(screen.getByRole('checkbox', { name: 'Dia inteiro' }))
    expect(screen.queryByLabelText('Hora do início')).not.toBeInTheDocument()
    await user.click(blockButton())
    await screen.findByText('Bloqueio criado: Domingo, 14/03/2027, dia inteiro.')
    expect(scheduleApi.blockBodies).toEqual([
      { starts_at: '2027-03-14T05:00:00Z', ends_at: '2027-03-15T04:00:00Z', reason: 'Folga' },
    ])
  })

  it('refuses before sending an end before the start, and an empty reason', async () => {
    const { user } = await renderPage('/painel/bloqueios', 'professional', 'Bloqueios')
    await screen.findByText('Nenhum bloqueio pela frente')

    await typeBlock(user, { day: '2026-11-14', from: '12:00', to: '09:00', reason: ' ' })
    await user.click(blockButton())
    expect(screen.getByLabelText('Hora do fim')).toHaveFocus()
    expect(screen.getByLabelText('Hora do fim')).toHaveAccessibleDescription('O fim precisa ser depois do início.')
    expect(screen.getByLabelText('Motivo')).toHaveAccessibleDescription(
      /Informe o motivo, como “Folga” ou “Consulta médica”/,
    )
    expect(scheduleApi.blockBodies).toHaveLength(0)
  })

  it('explains an overlap with a block already listed, without sending', async () => {
    teamApi.blocks = [
      { id: 'b1', professional_id: BRUNO_ID, starts_at: '2026-11-14T12:00:00Z', ends_at: '2026-11-14T15:00:00Z', reason: 'Curso' },
    ]
    const { user } = await renderPage('/painel/bloqueios', 'professional', 'Bloqueios')
    await screen.findByText('Curso')

    await typeBlock(user, { day: '2026-11-14', from: '11:00', to: '13:00', reason: 'Dentista' })
    await user.click(blockButton())

    const alert = await screen.findByText('Já existe um bloqueio nesse período')
    expect(alert.closest('[role="alert"]')).toHaveTextContent('sábado, 14/11/2026, 09:00–12:00: Curso')
    expect(scheduleApi.blockBodies).toHaveLength(0)
  })

  it('explains a 409 overlap that the list on the screen did not know, reading it again', async () => {
    const { user } = await renderPage('/painel/bloqueios', 'professional', 'Bloqueios')
    await screen.findByText('Nenhum bloqueio pela frente')
    // Created meanwhile, in another tab.
    teamApi.blocks = [
      { id: 'b1', professional_id: BRUNO_ID, starts_at: '2026-11-14T12:00:00Z', ends_at: '2026-11-14T15:00:00Z', reason: 'Curso' },
    ]
    scheduleApi.refuseBlock = { code: 'TIME_BLOCK_OVERLAP' }

    await typeBlock(user, { day: '2026-11-14', from: '11:00', to: '13:00', reason: 'Dentista' })
    await user.click(blockButton())

    const alert = (await screen.findByText('Já existe um bloqueio nesse período')).closest('[role="alert"]')
    expect(alert).toHaveTextContent('sábado, 14/11/2026, 09:00–12:00: Curso')
    await waitFor(() => expect(alert?.parentElement).toHaveFocus())
    expect(screen.getByLabelText('Motivo')).toHaveValue('Dentista')
    expect(await screen.findByRole('list', { name: /Próximos bloqueios/ })).toHaveTextContent('Curso')
  })

  it('lists the appointments of a 409 conflict, keeping what was typed', async () => {
    scheduleApi.refuseBlock = {
      code: 'APPOINTMENT_CONFLICTS',
      conflicts: [scheduled('a2', '2026-11-14T10:00'), scheduled('a1', '2026-11-14T09:00', { customer_name: 'Diego Rocha' })],
    }
    const { user } = await renderPage(`/painel/bloqueios?profissional=${BRUNO_ID}`, 'owner', 'Bloqueios')
    await screen.findByText('Nenhum bloqueio pela frente')

    await typeBlock(user, { day: '2026-11-14', from: '08:00', to: '12:00', reason: 'Folga' })
    await user.click(blockButton())

    expect(await screen.findByText('Há 2 agendamentos nesse período')).toBeInTheDocument()
    expect(screen.getByText(/O bloqueio não foi criado, porque não pode ficar sobre agendamentos/)).toBeInTheDocument()
    const links = within(screen.getByRole('list', { name: 'Agendamentos em conflito com o bloqueio' })).getAllByRole(
      'link',
    )
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'sábado, 14/11/2026, 09:00–09:30, Corte, Diego Rocha. Ver na agenda',
      'sábado, 14/11/2026, 10:00–10:30, Corte, Elisa Prado. Ver na agenda',
    ])
    expect(links[0]).toHaveAttribute('href', `/painel?dia=2026-11-14&profissional=${BRUNO_ID}`)
    expect(screen.getByLabelText('Motivo')).toHaveValue('Folga')
    expect(screen.getByLabelText('Hora do início')).toHaveValue('08:00')
  })

  it('removes a block after the confirmation, with the focus starting on "Manter bloqueio"', async () => {
    teamApi.blocks = [
      { id: 'b1', professional_id: BRUNO_ID, starts_at: '2026-11-14T03:00:00Z', ends_at: '2026-11-15T03:00:00Z', reason: 'Folga' },
    ]
    const { user } = await renderPage('/painel/bloqueios', 'professional', 'Bloqueios')

    await screen.findByText('Folga')
    const remove = await screen.findByRole('button', { name: 'Remover o bloqueio de sábado, 14/11/2026, dia inteiro' })
    await user.click(remove)
    let dialog = within(await screen.findByRole('alertdialog', { name: 'Remover este bloqueio?' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('sábado, 14/11/2026, dia inteiro: “Folga”.')
    expect(dialog.getByRole('button', { name: 'Manter bloqueio' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(remove).toHaveFocus()
    expect(scheduleApi.deletes).toHaveLength(0)

    await user.click(remove)
    dialog = within(await screen.findByRole('alertdialog'))
    await user.dblClick(dialog.getByRole('button', { name: 'Remover bloqueio' }))

    const notice = await screen.findByText('Bloqueio removido. O horário volta a aceitar reservas.')
    await waitFor(() => expect(notice.closest('[tabindex="-1"]')).toHaveFocus())
    expect(scheduleApi.deletes).toEqual(['b1'])
    expect(await screen.findByText('Nenhum bloqueio pela frente')).toBeInTheDocument()
  })

  it('keeps the dialog open on a failure, and closes it when the block was already removed', async () => {
    teamApi.blocks = [
      { id: 'b1', professional_id: BRUNO_ID, starts_at: '2026-11-14T12:00:00Z', ends_at: '2026-11-14T15:00:00Z', reason: 'Curso' },
    ]
    server.use(http.delete(`${API}/time-blocks/:id`, () => problem(500, 'INTERNAL_ERROR'), { once: true }))
    const { user } = await renderPage('/painel/bloqueios', 'professional', 'Bloqueios')

    await user.click(await screen.findByRole('button', { name: /Remover o bloqueio de sábado/ }))
    const dialog = within(await screen.findByRole('alertdialog'))
    await user.click(dialog.getByRole('button', { name: 'Remover bloqueio' }))
    expect(await dialog.findByText('Não foi possível remover')).toBeInTheDocument()

    teamApi.blocks = []
    await user.click(dialog.getByRole('button', { name: 'Remover bloqueio' }))
    expect(await screen.findByText('Esse bloqueio já tinha sido removido. A lista foi atualizada.')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Nenhum bloqueio pela frente')).toBeInTheDocument()
  })

  it('shows only the blocks to come, with the one under way marked', async () => {
    teamApi.blocks = [
      { id: 'b0', professional_id: BRUNO_ID, starts_at: '2026-11-10T12:00:00Z', ends_at: '2026-11-10T15:00:00Z', reason: 'Passado' },
      { id: 'b1', professional_id: BRUNO_ID, starts_at: '2026-11-12T15:00:00Z', ends_at: '2026-11-12T18:00:00Z', reason: 'Agora' },
    ]
    await renderPage('/painel/bloqueios', 'professional', 'Bloqueios')
    const list = within(await screen.findByRole('list', { name: /Próximos bloqueios/ }))
    expect(list.getByText('Agora')).toBeInTheDocument()
    expect(list.getByText('Em andamento')).toBeInTheDocument()
    expect(list.queryByText('Passado')).not.toBeInTheDocument()
  })

  it('gives the Owner the blocks of whoever is picked, and a Professional only the own', async () => {
    teamApi.blocks = [
      { id: 'b1', professional_id: BRUNO_ID, starts_at: '2026-11-14T12:00:00Z', ends_at: '2026-11-14T15:00:00Z', reason: 'Do Bruno' },
    ]
    const { user } = await renderPage('/painel/bloqueios', 'owner', 'Bloqueios')
    expect(await screen.findByText('Nenhum bloqueio pela frente')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Profissional' }))
    await user.click(await screen.findByRole('option', { name: 'Bruno Lima' }))
    expect(await screen.findByText('Do Bruno')).toBeInTheDocument()
  })
})

describe('roles (D74)', () => {
  it('tells an Owner who does not serve, with nobody in the team, what to do', async () => {
    server.use(http.get(`${API}/professionals`, () => HttpResponse.json([])))
    await renderPage('/painel/bloqueios', 'owner', 'Bloqueios')
    expect(await screen.findByText('Ninguém atende ainda')).toBeInTheDocument()
  })

  it('starts the Owner on the first of the team when the Owner does not serve', async () => {
    server.use(
      http.get(`${API}/professionals`, () =>
        HttpResponse.json([
          {
            id: BRUNO_ID,
            user_id: 'outro',
            name: 'Bruno Lima',
            email: 'bruno@exemplo.com',
            is_bookable: true,
            is_active: true,
            invitation_pending: false,
            service_ids: [],
          },
        ]),
      ),
    )
    await renderPage('/painel/expediente?profissional=desconhecido')
    expect(await screen.findByRole('combobox', { name: 'Profissional' })).toHaveTextContent('Bruno Lima')
  })

  it('tells a failed read of the team, with a new attempt', async () => {
    server.use(http.get(`${API}/professionals`, () => problem(500, 'INTERNAL_ERROR'), { once: true }))
    const { user } = await renderPage('/painel/expediente', 'professional')
    expect(await screen.findByText('Não foi possível carregar a equipe')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await day('Segunda-feira')).toBeTruthy()
  })
})
