import { expect, test, type Page } from '@playwright/test'

import { businessDay, DEMO } from './support.ts'

/**
 * E2E02 (UC02, UC15): the team signs in, through the demo shortcut and through
 * the form, and sees the agenda of the day, as Owner and as Professional. The
 * demo has appointments in the 7 days before today and the 6 after (D43), so
 * the current week always has a day with appointments, whatever today is.
 */

type Role = 'Dono' | 'Profissional'
type Way = 'pela demonstração' | 'pelo formulário'

const EMAIL: Record<Role, string> = { Dono: DEMO.owner, Profissional: DEMO.professional }
const OWNER_ONLY = ['Serviços', 'Equipe', 'Negócio']
/** A card of the agenda: its accessible name starts with "HH:MM–HH:MM". */
const APPOINTMENT = /^\d{2}:\d{2}–\d{2}:\d{2}, /

async function signIn(page: Page, role: Role, way: Way) {
  await page.goto('/entrar')
  if (way === 'pela demonstração') {
    await page.getByRole('button', { name: `Entrar como ${role}` }).click()
  } else {
    const form = page.getByRole('form', { name: 'Entrar com e-mail e senha' })
    await form.getByLabel('E-mail').fill(EMAIL[role])
    await form.getByLabel('Senha', { exact: true }).fill(DEMO.password)
    await form.getByRole('button', { name: 'Entrar', exact: true }).click()
  }
  await expect(page).toHaveURL(/\/painel$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
}

for (const role of ['Dono', 'Profissional'] as const) {
  for (const way of ['pela demonstração', 'pelo formulário'] as const) {
    test(`E2E02: ${role} entra ${way} e vê a agenda do dia`, async ({ page, isMobile }) => {
      // Either side of a midnight in São Paulo during the test is accepted.
      const before = businessDay()
      await signIn(page, role, way)
      const after = businessDay()

      // D103: "today" is the business's day, not Tokyo's.
      const today = page.getByText(/^[a-zà-ú-]+, \d{2}\/\d{2}\/\d{4}$/).first()
      await expect(today).toBeVisible()
      expect([before, after]).toContain((await today.textContent())?.trim())
      await expect(page.getByText(/ · (nenhum agendamento|\d+ agendamentos?)$/)).toBeVisible()

      // A day with appointments, chosen from what the page marks.
      if (isMobile) {
        const marked = page
          .getByRole('radiogroup', { name: 'Dia da semana' })
          .getByRole('radio', { name: /, com agendamentos$/ })
          .first()
        await marked.click()
        await expect(marked).toHaveAttribute('aria-checked', 'true')
        const list = page.getByRole('list', { name: 'Agendamentos do dia' })
        await expect(list.getByRole('button', { name: APPOINTMENT }).first()).toBeVisible()
      } else {
        await page.getByRole('tab', { name: 'Semana' }).click()
        const grid = page.getByRole('region', { name: /^Grade da semana de / })
        await expect(grid.getByRole('button', { name: APPOINTMENT }).first()).toBeVisible()
      }

      // D74: the Professional has no menu items of the Owner.
      if (isMobile) await page.getByRole('button', { name: 'Menu' }).click()
      const navigation = page.getByRole('link', { name: 'Expediente' })
      await expect(navigation).toBeVisible()
      for (const item of OWNER_ONLY) {
        await expect(page.getByRole('link', { name: item, exact: true })).toHaveCount(
          role === 'Dono' ? 1 : 0,
        )
      }
    })
  }
}
