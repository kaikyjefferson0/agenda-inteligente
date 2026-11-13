import { screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { authApi } from '@/test/msw/auth'
import { configApi } from '@/test/msw/configuration'
import { API, problem } from '@/test/msw/handlers'
import { server } from '@/test/msw/server'
import { CORTE_ID } from '@/test/msw/team-agenda'
import { renderPanel } from '@/test/panel'

const open = () => renderPanel('/painel/servicos', 'owner', 'Serviços')

/** The list of a group of services, by its heading ("Ativos (2)"). */
const group = (name: RegExp) => within(screen.getByRole('region', { name }))
const findGroup = async (name: RegExp) => within(await screen.findByRole('region', { name }))

describe('services (UC06, D90)', () => {
  it('lists the active services and, apart, the inactive ones, with duration, preparation and price', async () => {
    await open()
    const active = await findGroup(/^Ativos/)
    expect(active.getByRole('heading', { name: 'Corte' })).toBeInTheDocument()
    expect(active.getByText('R$ 50,00')).toBeInTheDocument()
    expect(active.getByRole('heading', { name: 'Barba' })).toBeInTheDocument()
    expect(active.getByText(/, sem preparo/)).toBeInTheDocument()

    const inactive = group(/^Inativos/)
    expect(inactive.getByRole('heading', { name: 'Coloração' })).toBeInTheDocument()
    expect(inactive.getByText('Inativo')).toBeInTheDocument()
    expect(inactive.getByRole('button', { name: 'Reativar Coloração' })).toBeInTheDocument()
  })

  it('creates a service, with the price typed in reais and sent in cents', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Novo serviço' }))
    const form = within(screen.getByRole('form', { name: 'Novo serviço' }))
    expect(form.getByLabelText('Nome')).toHaveFocus()
    expect(form.getByLabelText('Preparo')).toHaveValue('0')

    await user.type(form.getByLabelText('Nome'), 'Pigmentação')
    await user.type(form.getByLabelText('Duração'), '45')
    await user.type(form.getByLabelText('Preço'), '1.234,5')
    expect(form.getByText(/Cada agendamento ocupa 45 min da agenda/)).toBeInTheDocument()
    await user.click(form.getByRole('button', { name: 'Criar serviço' }))

    expect(configApi.bodies.services).toEqual([
      { name: 'Pigmentação', duration_minutes: 45, preparation_minutes: 0, price_cents: 123450 },
    ])
    const notice = await screen.findByText(/Pigmentação criado/)
    await waitFor(() => expect(notice.closest('[tabindex="-1"]')).toHaveFocus())
    expect(group(/^Ativos/).getByText('R$ 1.234,50')).toBeInTheDocument()
  })

  it('refuses what is past the limits before sending, with the focus on the first field', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Novo serviço' }))
    const form = within(screen.getByRole('form', { name: 'Novo serviço' }))
    await user.type(form.getByLabelText('Nome'), 'Dia de noiva')
    await user.type(form.getByLabelText('Duração'), '1441')
    await user.clear(form.getByLabelText('Preparo'))
    await user.type(form.getByLabelText('Preparo'), '1441')
    await user.type(form.getByLabelText('Preço'), '1.000.000,01')
    await user.click(form.getByRole('button', { name: 'Criar serviço' }))

    expect(form.getByText('A duração vai de 1 a 1440 minutos (24 horas).')).toBeInTheDocument()
    expect(form.getByText('O preparo vai de 0 a 1440 minutos (24 horas).')).toBeInTheDocument()
    expect(form.getByText('O preço vai até R$ 1.000.000,00.')).toBeInTheDocument()
    expect(form.getByLabelText('Duração')).toHaveFocus()
    expect(form.getByLabelText('Duração')).toHaveAccessibleDescription(/A duração vai de 1 a 1440/)
    expect(configApi.calls.createService).toBe(0)

    // The edges themselves are accepted.
    await user.clear(form.getByLabelText('Duração'))
    await user.type(form.getByLabelText('Duração'), '1440')
    await user.clear(form.getByLabelText('Preparo'))
    await user.type(form.getByLabelText('Preparo'), '1440')
    await user.clear(form.getByLabelText('Preço'))
    await user.type(form.getByLabelText('Preço'), '1.000.000,00')
    await user.click(form.getByRole('button', { name: 'Criar serviço' }))
    await screen.findByText(/Dia de noiva criado/)
    expect(configApi.bodies.services).toEqual([
      { name: 'Dia de noiva', duration_minutes: 1440, preparation_minutes: 1440, price_cents: 100_000_000 },
    ])
  })

  it('tells a field when leaving it, and cancelling gives the focus back', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Novo serviço' }))
    const form = within(screen.getByRole('form', { name: 'Novo serviço' }))
    await user.type(form.getByLabelText('Preço'), 'abc')
    await user.tab()
    expect(form.getByText('Use só números, como 50, 49,90 ou 1.234,56.')).toBeInTheDocument()
    // Only the fields already visited: the duration was never reached.
    expect(form.queryByText('Informe a duração, em minutos.')).not.toBeInTheDocument()

    await user.click(form.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('form', { name: 'Novo serviço' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Novo serviço' })).toHaveFocus())
  })

  it('edits only what changed, and saving with no change sends nothing', async () => {
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Editar Corte' }))
    let form = within(screen.getByRole('form', { name: 'Editar Corte' }))
    expect(form.getByLabelText('Nome')).toHaveFocus()
    expect(form.getByLabelText('Preço')).toHaveValue('50,00')
    await user.click(form.getByRole('button', { name: 'Salvar serviço' }))
    expect(configApi.calls.updateService).toBe(0)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar Corte' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Editar Corte' }))
    form = within(screen.getByRole('form', { name: 'Editar Corte' }))
    await user.clear(form.getByLabelText('Preço'))
    await user.type(form.getByLabelText('Preço'), 'R$ 55')
    await user.click(form.getByRole('button', { name: 'Salvar serviço' }))

    await screen.findByText(/Corte salvo/)
    expect(configApi.bodies.services).toEqual([{ price_cents: 5500 }])
    expect(group(/^Ativos/).getByText('R$ 55,00')).toBeInTheDocument()
  })

  it('deactivates by the PATCH, with no deleting, and brings an inactive one back', async () => {
    const { user, queryClient } = await open()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    // A double click sends once.
    await user.dblClick(await screen.findByRole('button', { name: 'Desativar Barba' }))

    await screen.findByText(/Barba desativado. Ele saiu da página pública/)
    expect(configApi.bodies.services).toEqual([{ is_active: false }])
    expect(group(/^Inativos/).getByRole('heading', { name: 'Barba' })).toBeInTheDocument()
    // D93: the catalog, the agenda and every public page of the business.
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toEqual(expect.arrayContaining([['team', 'services'], ['team', 'agenda'], ['public', 'business']]))

    await user.click(screen.getByRole('button', { name: 'Reativar Coloração' }))
    const notice = await screen.findByText(/Coloração reativado/)
    // The button moved to the other group: the notice takes the focus.
    await waitFor(() => expect(notice.closest('[tabindex="-1"]')).toHaveFocus())
    expect(group(/^Ativos/).getByRole('heading', { name: 'Coloração' })).toBeInTheDocument()
  })

  it('says when a refused change failed, without leaving the page', async () => {
    configApi.refuse.updateService = { status: 503, code: 'DATABASE_UNAVAILABLE' }
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Desativar Corte' }))
    expect(await screen.findByText('Não foi possível desativar Corte')).toBeInTheDocument()
    expect(group(/^Ativos/).getByRole('heading', { name: 'Corte' })).toBeInTheDocument()
  })

  it('shows its own text for a field the API refused (422), never the one of Pydantic', async () => {
    configApi.refuse.updateService = {
      status: 422,
      code: 'VALIDATION_ERROR',
      extra: {
        errors: [
          { loc: ['body', 'price_cents'], msg: 'Input should be less than or equal to 100000000', type: 'less_than_equal' },
        ],
      },
    }
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Editar Barba' }))
    const form = within(screen.getByRole('form', { name: 'Editar Barba' }))
    await user.clear(form.getByLabelText('Preço'))
    await user.type(form.getByLabelText('Preço'), '40')
    await user.click(form.getByRole('button', { name: 'Salvar serviço' }))

    expect(await form.findByText('O preço vai até R$ 1.000.000,00.')).toBeInTheDocument()
    expect(form.queryByText(/Input should be/)).not.toBeInTheDocument()
    expect(form.getByLabelText('Preço')).toHaveFocus()
  })

  it('on the demo, explains why the name is locked and there is no creating (RN28)', async () => {
    authApi.demo = true
    const { user } = await open()
    expect(await screen.findByText(/Os nomes dos serviços ficam travados/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Novo serviço' })).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Editar Corte' }))
    const form = within(screen.getByRole('form', { name: 'Editar Corte' }))
    const name = form.getByLabelText('Nome')
    expect(name).toHaveAttribute('readonly')
    expect(name).toHaveAccessibleDescription('Na demonstração, o nome dos serviços fica travado.')
    expect(form.getByLabelText('Duração')).toHaveFocus()

    await user.clear(form.getByLabelText('Duração'))
    await user.type(form.getByLabelText('Duração'), '35')
    await user.click(form.getByRole('button', { name: 'Salvar serviço' }))
    await screen.findByText(/Corte salvo/)
    expect(configApi.bodies.services).toEqual([{ duration_minutes: 35 }])
  })

  it('explains the DEMO_RESTRICTED of the API, if it comes anyway', async () => {
    configApi.refuse.updateService = { status: 403, code: 'DEMO_RESTRICTED' }
    const { user } = await open()
    await user.click(await screen.findByRole('button', { name: 'Editar Barba' }))
    const form = within(screen.getByRole('form', { name: 'Editar Barba' }))
    await user.type(form.getByLabelText('Nome'), ' clássica')
    await user.click(form.getByRole('button', { name: 'Salvar serviço' }))
    expect(await form.findByText('Esta ação não está disponível no negócio de demonstração.')).toBeInTheDocument()
    expect(form.getByLabelText('Nome')).toHaveValue('Barba clássica')
  })

  it('points out an active service nobody in the team serves (RN07)', async () => {
    configApi.team = configApi.members().map((member) => ({ ...member, service_ids: [CORTE_ID] }))
    await open()
    const active = await findGroup(/^Ativos/)
    const barba = active.getByRole('heading', { name: 'Barba' }).closest('li')!
    expect(within(barba).getByText(/Ninguém da equipe faz este serviço/)).toBeInTheDocument()
    const corte = active.getByRole('heading', { name: 'Corte' }).closest('li')!
    expect(within(corte).queryByText(/Ninguém da equipe/)).not.toBeInTheDocument()
    // An inactive service is out of the public page anyway: no hint.
    const coloracao = within(screen.getByRole('region', { name: /^Inativos/ }))
    expect(coloracao.queryByText(/Ninguém da equipe/)).not.toBeInTheDocument()
  })

  it('shows the empty state, with the way to the first service', async () => {
    configApi.services = []
    const { user } = await open()
    expect(await screen.findByText('Nenhum serviço ainda')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Criar serviço' }))
    expect(screen.getByRole('form', { name: 'Novo serviço' })).toBeInTheDocument()
  })

  it('shows a failure to read the catalog, with a new attempt', async () => {
    server.use(http.get(`${API}/services`, () => problem(500, 'INTERNAL_ERROR'), { once: true }))
    const { user } = await open()
    expect(await screen.findByText('Não foi possível carregar os serviços')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('heading', { name: 'Barba' })).toBeInTheDocument()
  })

  it('keeps a Professional out: the page goes back to the agenda (D74)', async () => {
    const { router } = await renderPanel('/painel/servicos', 'professional', 'Agenda')
    expect(router.state.location.pathname).toBe('/painel')
  })
})
