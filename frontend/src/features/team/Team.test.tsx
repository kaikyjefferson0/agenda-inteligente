import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { components } from '@/api/schema'
import { authApi, meOf } from '@/test/msw/auth'
import { configApi } from '@/test/msw/configuration'
import { ANA_ID, BARBA_ID, BRUNO_ID, CORTE_ID } from '@/test/msw/team-agenda'
import { renderPanel } from '@/test/panel'

type Professional = components['schemas']['ProfessionalData']
type Scheduled = components['schemas']['AppointmentData']

// 13:00 of Thursday, 12/11/2026 in São Paulo; already Friday, 01:00, in Tokyo (D56).
const NOW = new Date('2026-11-12T16:00:00Z')

const open = () => renderPanel('/painel/equipe', 'owner', 'Equipe')

/** One row of the team, by the name of the person. */
const row = async (name: string) => within(await screen.findByRole('listitem', { name }))

const DANI: Professional = {
  id: '9a0c1e2f-0000-4000-8000-00000000000d',
  user_id: '9a0c1e2f-0000-4000-8000-0000000000df',
  name: 'Dani Rocha',
  email: 'dani@exemplo.com',
  is_bookable: false,
  is_active: true,
  invitation_pending: true,
  service_ids: [],
}

function scheduled(id: string, local: string): Scheduled {
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
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('team (UC04, UC07, D91)', () => {
  it('shows where each one stands, the Owner first and who left apart', async () => {
    const { user } = await open()
    const ana = await row('Dona Ana')
    expect(ana.getByText('(você)')).toBeInTheDocument()
    expect(ana.getByText('Atende')).toBeInTheDocument()
    expect(ana.getByText('Barba, Corte')).toBeInTheDocument()
    expect(ana.getByRole('button', { name: 'Deixar de atender' })).toBeInTheDocument()

    const bruno = await row('Bruno Lima')
    expect(bruno.getByText('Ativo')).toBeInTheDocument()
    expect(bruno.getByRole('button', { name: 'Desativar Bruno Lima' })).toBeInTheDocument()

    expect(screen.queryByRole('listitem', { name: 'Carla Souza' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Desativados (1)' }))
    const carla = await row('Carla Souza')
    expect(carla.getByText('Desativado')).toBeInTheDocument()
    // Definitive (RN23): no action is left.
    expect(carla.queryByRole('button')).not.toBeInTheDocument()
  })

  it('invites by name and e-mail, and says until when the link is valid (202)', async () => {
    const { user } = await open()
    await user.type(await screen.findByLabelText('Nome'), 'Eva Lins')
    await user.type(screen.getByLabelText('E-mail'), 'eva@exemplo.com')
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))

    const sent = await screen.findByText(/Convite enviado para eva@exemplo.com/)
    await waitFor(() => expect(sent.closest('[role="status"]')).toHaveFocus())
    expect(sent.closest('[role="status"]')).toHaveTextContent(
      'O link vale até quinta-feira, 19/11/2026 às 13:00.',
    )
    expect(configApi.bodies.invites).toEqual([{ name: 'Eva Lins', email: 'eva@exemplo.com' }])
    expect(screen.getByLabelText('Nome')).toHaveValue('')
    const eva = await row('Eva Lins')
    expect(eva.getByText('Convite pendente')).toBeInTheDocument()
    expect(eva.getByText(/Entra nas reservas quando aceitar o convite/)).toBeInTheDocument()
    // No deactivating a pending invite: it would hold the e-mail for good.
    expect(eva.queryByRole('button', { name: /Desativar/ })).not.toBeInTheDocument()
  })

  it('checks the invite before sending', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Enviar convite' }))
    expect(screen.getByText('Informe o nome do profissional.')).toBeInTheDocument()
    expect(screen.getByText('Informe o e-mail para onde vai o convite.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveFocus()
    await user.type(screen.getByLabelText('Nome'), 'Eva')
    await user.type(screen.getByLabelText('E-mail'), 'eva@')
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))
    expect(screen.getByText('Confira o e-mail, como nome@exemplo.com.')).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toHaveFocus()
    expect(configApi.calls.invite).toBe(0)
  })

  it('explains EMAIL_IN_USE on the e-mail field, with the focus there', async () => {
    configApi.refuse.invite = { status: 409, code: 'EMAIL_IN_USE' }
    const { user } = await open()
    await user.type(await screen.findByLabelText('Nome'), 'Bruno')
    await user.type(screen.getByLabelText('E-mail'), 'bruno@exemplo.com')
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))

    const email = screen.getByLabelText('E-mail')
    await waitFor(() => expect(email).toHaveFocus())
    expect(email).toHaveAccessibleDescription(/Este e-mail já tem conta/)
    // Changing the e-mail clears it.
    await user.type(email, 'r')
    expect(screen.queryByText(/Este e-mail já tem conta/)).not.toBeInTheDocument()
  })

  it('holds the invites for the Retry-After of a 429 (RN26)', async () => {
    configApi.team = [...configApi.members(), DANI]
    configApi.refuse.invite = { status: 429, code: 'RATE_LIMITED', headers: { 'Retry-After': '120' } }
    const { user } = await open()
    await user.type(await screen.findByLabelText('Nome'), 'Eva')
    await user.type(screen.getByLabelText('E-mail'), 'eva@exemplo.com')
    await user.click(screen.getByRole('button', { name: 'Enviar convite' }))

    expect(await screen.findByText(/Muitas tentativas seguidas.*Tente de novo em 2 minutos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aguarde 2 min' })).toBeDisabled()
    // The limit is per business: renewing waits too.
    expect(screen.getByRole('button', { name: 'Reenviar convite para Dani Rocha' })).toBeDisabled()
    expect(screen.getByLabelText('Nome')).toHaveValue('Eva')
  })

  it('renews a pending invite, by its button or by the form (RN24)', async () => {
    configApi.team = [...configApi.members(), DANI]
    const { user } = await open()
    const dani = await row('Dani Rocha')
    // A double click sends once.
    await user.dblClick(dani.getByRole('button', { name: 'Reenviar convite para Dani Rocha' }))

    const notice = await screen.findByText(/Convite reenviado para dani@exemplo.com/)
    expect(notice).toHaveTextContent('o anterior deixou de valer')
    expect(configApi.bodies.invites).toEqual([{ name: 'Dani Rocha', email: 'dani@exemplo.com' }])

    await user.type(screen.getByLabelText('Nome'), 'Daniela Rocha')
    await user.type(screen.getByLabelText('E-mail'), 'DANI@exemplo.com')
    await user.dblClick(screen.getByRole('button', { name: 'Enviar convite' }))
    expect(await screen.findByText(/Convite renovado para DANI@exemplo.com/)).toBeInTheDocument()
    expect(configApi.calls.invite).toBe(2)
    expect(await row('Daniela Rocha')).toBeTruthy()
  })

  it('on the demo, explains why invites are off (RN28)', async () => {
    authApi.demo = true
    configApi.team = [...configApi.members(), DANI]
    await open()
    expect(await screen.findByText('Convites desligados na demonstração')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enviar convite' })).not.toBeInTheDocument()
    expect((await row('Dani Rocha')).queryByRole('button', { name: /Reenviar/ })).not.toBeInTheDocument()
  })

  it('lets the Owner start serving when there is no record (201)', async () => {
    configApi.team = configApi.members().filter((member) => member.id !== ANA_ID)
    const { user } = await open()
    expect(await screen.findByRole('heading', { name: 'Você não atende clientes' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Também atendo' }))

    const notice = await screen.findByText(/Você voltou às reservas como profissional/)
    await waitFor(() => expect(notice.closest('[tabindex="-1"]')).toHaveFocus())
    expect(notice).toHaveTextContent('Escolha seus serviços abaixo')
    expect(within(notice).getByRole('link', { name: 'seu expediente' })).toHaveAttribute('href', '/painel/expediente')
    expect((await row(meOf().user.name)).getByText('Atende')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Você não atende clientes' })).not.toBeInTheDocument()
    expect(configApi.calls.serve).toBe(1)
  })

  it('brings back an Owner who stopped serving (200)', async () => {
    configApi.team = configApi.members().map((member) =>
      member.id === ANA_ID ? { ...member, is_bookable: false } : member,
    )
    const { user } = await open()
    const ana = await row('Dona Ana')
    expect(ana.getByText('Não atende')).toBeInTheDocument()
    await user.click(ana.getByRole('button', { name: 'Também atendo' }))
    await screen.findByText(/Você voltou às reservas/)
    expect((await row('Dona Ana')).getByText('Atende')).toBeInTheDocument()
  })

  it('deactivates only after a confirmation that says it is definitive (RN23)', async () => {
    const { user, queryClient } = await open()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const bruno = await row('Bruno Lima')
    const trigger = bruno.getByRole('button', { name: 'Desativar Bruno Lima' })
    await user.click(trigger)

    const dialog = await screen.findByRole('alertdialog', { name: 'Desativar Bruno Lima?' })
    expect(dialog).toHaveTextContent('É definitivo: não há como reativar.')
    expect(dialog).toHaveTextContent('bruno@exemplo.com não pode ser convidado de novo')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Manter na equipe' })).toHaveFocus())

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(configApi.calls.deactivate).toBe(0)

    await user.click(trigger)
    const again = await screen.findByRole('alertdialog')
    await user.dblClick(within(again).getByRole('button', { name: 'Desativar definitivamente' }))

    const notice = await screen.findByText('Bruno Lima foi desativado: perdeu o acesso e saiu das novas reservas.')
    await waitFor(() => expect(notice.closest('[tabindex="-1"]')).toHaveFocus())
    expect(configApi.calls.deactivate).toBe(1)
    expect(screen.getByRole('button', { name: 'Desativados (2)' })).toBeInTheDocument()
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toEqual(expect.arrayContaining([['team', 'professionals'], ['team', 'agenda'], ['public', 'business']]))
  })

  it('lists the future appointments of a refused deactivation, each with its day in the agenda', async () => {
    configApi.refuse.deactivate = {
      status: 409,
      code: 'APPOINTMENT_CONFLICTS',
      extra: { conflicts: [scheduled('a2', '2026-11-14T09:00'), scheduled('a1', '2026-11-13T10:00')] },
    }
    const { user } = await open()
    await user.click((await row('Bruno Lima')).getByRole('button', { name: 'Desativar Bruno Lima' }))
    await user.click(await screen.findByRole('button', { name: 'Desativar definitivamente' }))

    const title = await screen.findByText('Bruno tem 2 agendamentos pela frente')
    await waitFor(() => expect(title.closest('[tabindex="-1"]')).toHaveFocus())
    expect(screen.getByText(/Ninguém foi desativado/)).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    const links = within(screen.getByRole('list', { name: 'Agendamentos futuros de Bruno Lima' })).getAllByRole('link')
    // In order, in the clock of the business.
    expect(links[0]).toHaveAccessibleName('sexta-feira, 13/11/2026, 10:00–10:30, Corte, Elisa Prado. Ver na agenda')
    expect(links[0]).toHaveAttribute('href', `/painel?dia=2026-11-13&profissional=${BRUNO_ID}`)
    expect(links[1]).toHaveAttribute('href', `/painel?dia=2026-11-14&profissional=${BRUNO_ID}`)
    expect((await row('Bruno Lima')).getByText('Ativo')).toBeInTheDocument()
  })

  it('keeps the dialog open on a failure of the network, to try again', async () => {
    configApi.refuse.deactivate = { status: 503, code: 'DATABASE_UNAVAILABLE' }
    const { user } = await open()
    await user.click((await row('Bruno Lima')).getByRole('button', { name: 'Desativar Bruno Lima' }))
    await user.click(await screen.findByRole('button', { name: 'Desativar definitivamente' }))
    const dialog = screen.getByRole('alertdialog')
    expect(await within(dialog).findByText('Não foi possível desativar')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Desativar definitivamente' }))
    await screen.findByText(/Bruno Lima foi desativado/)
  })

  it('closes and reads the team again when the professional is gone (404)', async () => {
    configApi.refuse.deactivate = { status: 404, code: 'NOT_FOUND' }
    const { user } = await open()
    await user.click((await row('Bruno Lima')).getByRole('button', { name: 'Desativar Bruno Lima' }))
    await user.click(await screen.findByRole('button', { name: 'Desativar definitivamente' }))
    expect(await screen.findByText('Bruno Lima não está mais na equipe')).toBeInTheDocument()
  })

  it('for the Owner, "Deixar de atender" is not definitive and keeps the login', async () => {
    const { user } = await open()
    await user.click((await row('Dona Ana')).getByRole('button', { name: 'Deixar de atender' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Deixar de atender?' })
    expect(dialog).not.toHaveTextContent(/definitivo/)
    expect(dialog).toHaveTextContent('continua entrando no painel')
    await user.click(within(dialog).getByRole('button', { name: 'Deixar de atender' }))

    await screen.findByText('Você saiu das novas reservas. Para voltar, use “Também atendo”.')
    const ana = await row('Dona Ana')
    expect(ana.getByText('Não atende')).toBeInTheDocument()
    expect(ana.getByRole('button', { name: 'Também atendo' })).toBeInTheDocument()
  })

  it('tells the Owner, in the first person, about the own future appointments', async () => {
    configApi.refuse.deactivate = {
      status: 409,
      code: 'APPOINTMENT_CONFLICTS',
      extra: { conflicts: [{ ...scheduled('a1', '2026-11-13T10:00'), professional_id: ANA_ID }] },
    }
    const { user } = await open()
    await user.click((await row('Dona Ana')).getByRole('button', { name: 'Deixar de atender' }))
    await user.click(await within(await screen.findByRole('alertdialog')).findByRole('button', { name: 'Deixar de atender' }))
    expect(await screen.findByText('Você tem um agendamento pela frente')).toBeInTheDocument()
    expect(screen.getByText(/Você continua nas reservas/)).toBeInTheDocument()
  })

  it('chooses the services of a professional, with the inactive ones marked (UC07)', async () => {
    const { user } = await open()
    const bruno = await row('Bruno Lima')
    const toggle = bruno.getByRole('button', { name: 'Serviços de Bruno Lima' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const form = within(bruno.getByRole('form', { name: 'Serviços de Bruno Lima' }))
    const boxes = form.getAllByRole('checkbox')
    expect(boxes[0]).toHaveFocus()
    expect(form.getByRole('checkbox', { name: /Corte/ })).toBeChecked()
    expect(form.getByRole('checkbox', { name: /Coloração/ })).toHaveAccessibleDescription('Inativo')
    expect(form.getByRole('button', { name: 'Salvar serviços' })).toBeDisabled()

    await user.click(form.getByRole('checkbox', { name: /Barba/ }))
    await user.click(form.getByRole('button', { name: 'Salvar serviços' }))

    const saved = await form.findByText('Serviços de Bruno salvos.')
    await waitFor(() => expect(saved).toHaveFocus())
    expect(configApi.bodies.setServices).toEqual([{ service_ids: [CORTE_ID, BARBA_ID] }])
    expect(bruno.getByText('Barba, Corte')).toBeInTheDocument()

    await user.click(form.getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(toggle).toHaveFocus())
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('tells a failure to save the services, and keeps the choice', async () => {
    configApi.refuse.setServices = { status: 404, code: 'NOT_FOUND' }
    const { user } = await open()
    const bruno = await row('Bruno Lima')
    await user.click(bruno.getByRole('button', { name: 'Serviços de Bruno Lima' }))
    const form = within(bruno.getByRole('form', { name: 'Serviços de Bruno Lima' }))
    await user.click(form.getByRole('checkbox', { name: /Coloração/ }))
    // A double click sends once.
    await user.dblClick(form.getByRole('button', { name: 'Salvar serviços' }))
    expect(await form.findByText('Não foi possível salvar os serviços')).toBeInTheDocument()
    expect(configApi.calls.setServices).toBe(1)
    expect(form.getByRole('checkbox', { name: /Coloração/ })).toBeChecked()
    expect(form.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
  })

  it('shows a failure to read the team, with a new attempt', async () => {
    const { server } = await import('@/test/msw/server')
    const { http } = await import('msw')
    const { API, problem } = await import('@/test/msw/handlers')
    server.use(http.get(`${API}/professionals`, () => problem(500, 'INTERNAL_ERROR'), { once: true }))
    const { user } = await open()
    expect(await screen.findByText('Não foi possível carregar a equipe')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await row('Bruno Lima')).toBeTruthy()
  })

  it('keeps a Professional out: the page goes back to the agenda (D74)', async () => {
    const { router } = await renderPanel('/painel/equipe', 'professional', 'Agenda')
    expect(router.state.location.pathname).toBe('/painel')
  })
})
