import { screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { components } from '@/api/schema'
import { authApi } from '@/test/msw/auth'
import { configApi } from '@/test/msw/configuration'
import { API, problem } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'
import { BRUNO_ID, CORTE_ID } from '@/test/msw/team-agenda'
import { renderPanel } from '@/test/panel'

type Scheduled = components['schemas']['AppointmentData']

// 13:00 of Thursday, 12/11/2026 in São Paulo; already Friday, 01:00, in Tokyo (D56).
const NOW = new Date('2026-11-12T16:00:00Z')

const open = () => renderPanel('/painel/negocio', 'owner', 'Negócio')
const save = () => screen.getByRole('button', { name: 'Salvar' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('business settings (UC05, D92)', () => {
  it('opens with the saved values, each advance in its largest exact unit', async () => {
    await open()
    expect(await screen.findByLabelText('Nome do negócio')).toHaveValue('Barbearia Central')
    expect(screen.getByLabelText('Endereço')).toHaveValue('barbearia-central')
    expect(screen.getByLabelText('Endereço da página pública')).toHaveValue(
      `${window.location.origin}/n/barbearia-central`,
    )
    expect(screen.getByRole('link', { name: /Abrir a página pública/ })).toHaveAttribute('href', '/n/barbearia-central')
    expect(screen.getByRole('button', { name: 'Copiar link' })).toBeInTheDocument()
    expect(screen.getByLabelText('Fuso do negócio')).toHaveValue('America/Sao_Paulo')
    expect(screen.getByRole('radio', { name: '15 min' })).toBeChecked()
    expect(screen.getByLabelText('Antecedência mínima')).toHaveValue('1')
    expect(screen.getByLabelText('Unidade de antecedência mínima')).toHaveDisplayValue('hora')
    expect(screen.getByLabelText('Antecedência máxima')).toHaveValue('30')
    expect(screen.getByLabelText('Prazo para o cliente alterar')).toHaveValue('2')
    expect(screen.getByLabelText('Unidade de prazo para o cliente alterar')).toHaveDisplayValue('horas')
    expect(save()).toBeDisabled()
    expect(screen.getByText('Nenhuma alteração.')).toBeInTheDocument()
  })

  it('shows 1440 minutes as one day and 90 as 90 minutes', async () => {
    configApi.business = { ...configApi.business, min_advance_minutes: 90, change_deadline_minutes: 1440 }
    await open()
    expect(await screen.findByLabelText('Antecedência mínima')).toHaveValue('90')
    expect(screen.getByLabelText('Unidade de antecedência mínima')).toHaveDisplayValue('minutos')
    expect(screen.getByLabelText('Prazo para o cliente alterar')).toHaveValue('1')
    expect(screen.getByLabelText('Unidade de prazo para o cliente alterar')).toHaveDisplayValue('dia')
  })

  it('refuses a minimum advance above the maximum before sending (RN05)', async () => {
    const { user } = await open()
    const min = await screen.findByLabelText('Antecedência mínima')
    await user.clear(min)
    await user.type(min, '31')
    await user.selectOptions(screen.getByLabelText('Unidade de antecedência mínima'), 'days')
    await user.click(save())

    expect(min).toHaveFocus()
    expect(min).toHaveAccessibleDescription(/A antecedência mínima não pode passar da máxima \(30 dias\)/)
    expect(configApi.calls.patchBusiness).toBe(0)

    // Raising the maximum fixes it, and only the two values go.
    await user.clear(screen.getByLabelText('Antecedência máxima'))
    await user.type(screen.getByLabelText('Antecedência máxima'), '60')
    expect(screen.queryByText(/não pode passar da máxima/)).not.toBeInTheDocument()
    await user.click(save())
    await screen.findByText(/Configurações salvas/)
    expect(configApi.bodies.business).toEqual([{ min_advance_minutes: 44_640, max_advance_days: 60 }])
  })

  it('keeps every value within the limits of the API', async () => {
    const { user } = await open()
    const max = await screen.findByLabelText('Antecedência máxima')
    await user.clear(max)
    await user.type(max, '366')
    const deadline = screen.getByLabelText('Prazo para o cliente alterar')
    await user.clear(deadline)
    await user.type(deadline, '31')
    await user.selectOptions(screen.getByLabelText('Unidade de prazo para o cliente alterar'), 'days')
    await user.click(save())

    expect(max).toHaveFocus()
    expect(screen.getByText('Use de 1 a 365 dias.')).toBeInTheDocument()
    expect(screen.getByText('O prazo vai até 30 dias.')).toBeInTheDocument()
    expect(configApi.calls.patchBusiness).toBe(0)
  })

  it('saves only what changed, and refreshes what depends on it (D93)', async () => {
    const { user, queryClient } = await open()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const meBefore = authApi.calls.me
    await user.click(await screen.findByRole('radio', { name: '30 min' }))
    const deadline = screen.getByLabelText('Prazo para o cliente alterar')
    await user.clear(deadline)
    await user.type(deadline, '1')
    await user.selectOptions(screen.getByLabelText('Unidade de prazo para o cliente alterar'), 'days')
    expect(screen.getByText('Alterações não salvas.')).toBeInTheDocument()
    await user.click(save())

    const notice = await screen.findByText('Configurações salvas. Elas valem para as próximas reservas.')
    await waitFor(() => expect(notice.closest('[tabindex="-1"]')).toHaveFocus())
    expect(configApi.bodies.business).toEqual([{ slot_step_minutes: 30, change_deadline_minutes: 1440 }])
    expect(save()).toBeDisabled()
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toEqual(expect.arrayContaining([['team'], ['public', 'business'], ['auth', 'me']]))
    await waitFor(() => expect(authApi.calls.me).toBeGreaterThan(meBefore))
  })

  it('keeps the slug in lowercase and explains a slug in use on its field', async () => {
    configApi.refuse.business = { status: 409, code: 'SLUG_IN_USE' }
    const { user } = await open()
    const slug = await screen.findByLabelText('Endereço')
    await user.clear(slug)
    await user.type(slug, 'Barbearia Nova')
    expect(slug).toHaveValue('barbearia-nova')
    await user.click(save())

    await waitFor(() => expect(slug).toHaveFocus())
    expect(slug).toHaveAccessibleDescription(/Este endereço já é de outro negócio/)
    expect(configApi.bodies.business).toEqual([{ slug: 'barbearia-nova' }])
    // The saved address stays the one the public uses.
    expect(screen.getByLabelText('Endereço da página pública')).toHaveValue(
      `${window.location.origin}/n/barbearia-central`,
    )

    await user.type(slug, '-2')
    expect(screen.queryByText(/Este endereço já é de outro negócio/)).not.toBeInTheDocument()
    await user.click(save())
    await screen.findByText(/Configurações salvas/)
    expect(screen.getByLabelText('Endereço da página pública')).toHaveValue(
      `${window.location.origin}/n/barbearia-nova-2`,
    )
  })

  it('refuses an invalid slug before sending', async () => {
    const { user } = await open()
    const slug = await screen.findByLabelText('Endereço')
    await user.clear(slug)
    await user.type(slug, 'café')
    await user.tab()
    expect(screen.getByText(/Use só letras minúsculas sem acento/)).toBeInTheDocument()
    await user.click(save())
    expect(slug).toHaveFocus()
    expect(configApi.calls.patchBusiness).toBe(0)
  })

  it('shows its own text for a field the API refused (422)', async () => {
    configApi.refuse.business = {
      status: 422,
      code: 'VALIDATION_ERROR',
      extra: { errors: [{ loc: ['body', 'timezone'], msg: 'Invalid timezone', type: 'value_error' }] },
    }
    const { user } = await open()
    await user.selectOptions(await screen.findByLabelText('Fuso do negócio'), 'Europe/Lisbon')
    await user.click(save())
    await user.click(await screen.findByRole('button', { name: 'Trocar o fuso e salvar' }))
    expect(await screen.findByText('A API não reconhece este fuso. Escolha outro da lista.')).toBeInTheDocument()
    expect(screen.queryByText('Invalid timezone')).not.toBeInTheDocument()
  })

  it('warns before changing the time zone, and lists who fell outside the hours (RN22)', async () => {
    // 09:00 in São Paulo is 08:00 in Manaus: outside an expediente that opens at 09:00.
    const start = Date.parse('2026-11-13T09:00:00-03:00')
    const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')
    const outside: Scheduled = {
      id: 'a1',
      professional_id: BRUNO_ID,
      service_id: CORTE_ID,
      starts_at: iso(start),
      ends_at: iso(start + 30 * 60_000),
      blocked_until: iso(start + 40 * 60_000),
      status: 'confirmed',
      customer_name: 'Elisa Prado',
    }
    configApi.outside = [outside]
    const { user } = await open()
    await user.selectOptions(await screen.findByLabelText('Fuso do negócio'), 'America/Manaus')
    await user.click(save())

    const dialog = await screen.findByRole('alertdialog', { name: 'Trocar o fuso do negócio?' })
    expect(dialog).toHaveTextContent('De São Paulo e Brasília · GMT−3 para Manaus · GMT−4.')
    expect(dialog).toHaveTextContent('O expediente continua nas mesmas horas do relógio')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Manter o fuso atual' })).toHaveFocus())
    await user.click(within(dialog).getByRole('button', { name: 'Manter o fuso atual' }))
    expect(configApi.calls.patchBusiness).toBe(0)
    expect(screen.getByLabelText('Fuso do negócio')).toHaveValue('America/Manaus')

    await user.click(save())
    await user.click(await screen.findByRole('button', { name: 'Trocar o fuso e salvar' }))

    const title = await screen.findByText('Fuso trocado. 1 agendamento ficou fora do expediente')
    await waitFor(() => expect(title.closest('[tabindex="-1"]')).toHaveFocus())
    expect(screen.getByText(/Ele continua marcado no mesmo instante/)).toBeInTheDocument()
    expect(configApi.bodies.business).toEqual([{ timezone: 'America/Manaus' }])
    const link = within(screen.getByRole('list', { name: 'Agendamentos fora do expediente no novo fuso' })).getByRole('link')
    // In the new zone, with the professional, and to the day of the agenda with the filter.
    expect(link).toHaveAccessibleName('sexta-feira, 13/11/2026, 08:00–08:30, Corte, Elisa Prado, com Bruno Lima. Ver na agenda')
    expect(link).toHaveAttribute('href', `/painel?dia=2026-11-13&profissional=${BRUNO_ID}`)
  })

  it('on the demo, locks the name and the slug and still saves the rest (RN28)', async () => {
    configApi.business = { ...configApi.business, is_demo: true }
    const { user } = await open()
    expect(await screen.findByText(/O nome e o endereço ficam travados/)).toBeInTheDocument()
    const name = screen.getByLabelText('Nome do negócio')
    expect(name).toHaveAttribute('readonly')
    expect(name).toHaveAccessibleDescription(/Travado na demonstração/)
    expect(screen.getByLabelText('Endereço')).toHaveAttribute('readonly')

    await user.click(screen.getByRole('radio', { name: '10 min' }))
    // A double click sends once, also when the answer comes between the two clicks.
    await user.dblClick(save())
    await screen.findByText(/Configurações salvas/)
    expect(configApi.bodies.business).toEqual([{ slot_step_minutes: 10 }])
  })

  it('shows a failure to save below the form, keeping what was typed', async () => {
    configApi.refuse.business = { status: 403, code: 'DEMO_RESTRICTED' }
    const { user } = await open()
    await user.type(await screen.findByLabelText('Nome do negócio'), ' 2')
    await user.click(save())
    expect(await screen.findByText('Não foi possível salvar as configurações')).toBeInTheDocument()
    expect(screen.getByText('Esta ação não está disponível no negócio de demonstração.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome do negócio')).toHaveValue('Barbearia Central 2')
  })

  it('shows a failure to read the settings, with a new attempt', async () => {
    server.use(http.get(`${API}/business`, () => problem(500, 'INTERNAL_ERROR'), { once: true }))
    const { user } = await open()
    expect(await screen.findByText('Não foi possível carregar as configurações')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByLabelText('Nome do negócio')).toHaveValue('Barbearia Central')
  })

  it('keeps a Professional out: the page goes back to the agenda (D74)', async () => {
    const { router } = await renderPanel('/painel/negocio', 'professional', 'Agenda')
    expect(router.state.location.pathname).toBe('/painel')
  })
})
