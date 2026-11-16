import type { Page, Response } from '@playwright/test'

import { API, expect, isApiCall, REFRESH_COOKIE, signInAsDemo, signOut, test } from './support.ts'

/**
 * Items 6 and 7 of step 10: the Owner signs in through the demo shortcut, a
 * reload keeps the session (the refresh cookie works), the cookie has the
 * right attributes; then the Professional signs in and sees only the own agenda.
 */

const OWNER_ONLY = ['Serviços', 'Equipe', 'Negócio']

interface Appointment {
  professional_id: string
}

/** The professional ids of every agenda the panel loads while `action` runs. */
async function agendaProfessionals(page: Page, action: () => Promise<void>): Promise<Set<string>> {
  const ids = new Set<string>()
  const pending: Promise<void>[] = []
  const listener = (response: Response) => {
    if (isApiCall('/api/v1/appointments', 'GET')(response) && response.ok()) {
      pending.push(
        response.json().then((list: Appointment[]) => {
          for (const item of list) ids.add(item.professional_id)
        }),
      )
    }
  }
  page.on('response', listener)
  try {
    await action()
    await Promise.all(pending)
  } finally {
    page.off('response', listener)
  }
  return ids
}

/**
 * The week view. The day view already read the whole week (the query is per
 * week), so the grid may come from the cache, without a new request.
 */
async function showWeek(page: Page) {
  await page.getByRole('tab', { name: 'Semana' }).click()
  await expect(page.getByRole('region', { name: /^Grade da semana de / })).toBeVisible()
}

test('item 6: Dono entra pela demo, recarrega e continua logado; cookie certo; sai', async ({
  page,
  context,
}) => {
  const team = await agendaProfessionals(page, async () => {
    await signInAsDemo(page, 'Dono')
    await showWeek(page)
  })

  // The agenda of the team: the professional filter and the Owner's menu.
  await expect(page.getByRole('combobox', { name: 'Profissional' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Profissional' })).toHaveText('Todos os profissionais')
  for (const item of OWNER_ONLY) {
    await expect(page.getByRole('link', { name: item, exact: true })).toBeVisible()
  }
  console.log(`[smoke] Dono: agenda da semana com ${team.size} profissionais`)
  expect(team.size, 'a agenda do Dono mostra mais de um profissional').toBeGreaterThan(1)

  // The cookie of the API (D108).
  const cookies = await context.cookies(API)
  const refresh = cookies.find((cookie) => cookie.name === REFRESH_COOKIE)
  expect(refresh, `cookie ${REFRESH_COOKIE} em ${API}`).toBeDefined()
  expect(refresh).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    // __Host-: no Domain attribute, so the cookie belongs to the API host only.
    domain: new URL(API).hostname,
  })

  // A reload renews the session with the cookie, in silence (D71).
  const renewed = page.waitForResponse(isApiCall('/api/v1/auth/refresh', 'POST'))
  await page.reload()
  expect((await renewed).status(), 'refresh ao recarregar').toBe(200)
  await expect(page).toHaveURL(/\/painel/)
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()

  await signOut(page)
  expect(
    (await context.cookies(API)).find((cookie) => cookie.name === REFRESH_COOKIE),
    'o logout apaga o cookie',
  ).toBeUndefined()
})

test('item 7: Profissional entra e vê só a própria agenda', async ({ page }) => {
  const me = page.waitForResponse(isApiCall('/api/v1/auth/me', 'GET'))
  const professionals = page.waitForResponse(isApiCall('/api/v1/professionals', 'GET'))
  const seen = await agendaProfessionals(page, async () => {
    await signInAsDemo(page, 'Profissional')
    await showWeek(page)
  })

  const userId = ((await (await me).json()) as { user: { id: string; role: string } }).user
  expect(userId.role).toBe('professional')
  const team = (await (await professionals).json()) as { id: string; user_id: string | null }[]
  const own = team.find((item) => item.user_id === userId.id)
  expect(own, 'o Profissional está na lista da equipe').toBeDefined()

  console.log(`[smoke] Profissional: ${seen.size} profissional(is) nas agendas carregadas`)
  expect([...seen], 'as agendas carregadas são só do próprio profissional').toEqual(
    seen.size === 0 ? [] : [own?.id],
  )

  // No filter and no menu items of the Owner (D74).
  await expect(page.getByRole('combobox', { name: 'Profissional' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Expediente' })).toBeVisible()
  for (const item of OWNER_ONLY) {
    await expect(page.getByRole('link', { name: item, exact: true })).toHaveCount(0)
  }

  await signOut(page)
})
