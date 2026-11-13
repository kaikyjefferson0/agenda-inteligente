import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { getAppSession } from '@/features/auth'
import { renderPanel } from '@/test/panel'

const open = () => renderPanel('/painel/negocio', 'owner', 'Negócio')
const menuLink = (name: string) => screen.getAllByRole('link', { name }).at(0)!

async function changeMaxAdvance(user: Awaited<ReturnType<typeof open>>['user']) {
  const field = await screen.findByLabelText('Antecedência máxima')
  await user.clear(field)
  await user.type(field, '60')
}

/** A `beforeunload` as the browser sends it: cancelable, so asking shows as `defaultPrevented`. */
function closeTab() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

describe('leaving the panel with changes not saved (D100)', () => {
  it('leaves at once when nothing changed, and the tab closes without a question', async () => {
    const { user, router } = await open()
    expect(closeTab().defaultPrevented).toBe(false)
    await user.click(menuLink('Equipe'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipe' })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/painel/equipe')
  })

  it('asks before leaving with changes: keeps them, or discards and goes', async () => {
    const { user, router } = await open()
    await changeMaxAdvance(user)
    expect(closeTab().defaultPrevented).toBe(true)

    await user.click(menuLink('Equipe'))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sair sem salvar?' })
    expect(dialog).toHaveTextContent('Esta página tem alterações que não foram salvas')
    // A distracted Enter keeps the work.
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Continuar editando' })).toHaveFocus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/painel/negocio')
    expect(screen.getByLabelText('Antecedência máxima')).toHaveValue('60')

    await user.click(menuLink('Equipe'))
    await user.click(await screen.findByRole('button', { name: 'Descartar e sair' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipe' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/painel/equipe')
    // The form left behind no longer counts.
    expect(closeTab().defaultPrevented).toBe(false)
  })

  it('leaves without a question after saving', async () => {
    const { user } = await open()
    await changeMaxAdvance(user)
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }))
    await screen.findByText(/Configurações salvas/)
    expect(closeTab().defaultPrevented).toBe(false)

    await user.click(menuLink('Equipe'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Equipe' })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks before "Sair", which ends the session before any navigation', async () => {
    const { user, router } = await open()
    await changeMaxAdvance(user)
    await user.click(screen.getAllByRole('button', { name: 'Sair' }).at(0)!)
    expect(await screen.findByRole('alertdialog', { name: 'Sair sem salvar?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continuar editando' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(getAppSession().getState().status).toBe('authenticated')

    await user.click(screen.getAllByRole('button', { name: 'Sair' }).at(0)!)
    await user.click(await screen.findByRole('button', { name: 'Descartar e sair' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'))
  })

  it('never holds the panel when the session ends elsewhere', async () => {
    const { user, router } = await open()
    await changeMaxAdvance(user)
    // As a refused refresh, or "Sair" in another tab (D73).
    act(() => getAppSession().end('expired'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
