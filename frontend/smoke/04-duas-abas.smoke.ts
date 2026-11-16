import type { APIRequestContext, BrowserContext, Page, Response } from '@playwright/test'

import {
  API,
  DEMO,
  expect,
  isApiCall,
  LONG,
  REFRESH_COOKIE,
  signInAsDemo,
  signOut,
  SITE,
  test,
} from './support.ts'

/**
 * Item 8 of step 10: two tabs of the same browser share the session (D70 to
 * D73). Reloading both at once keeps both signed in; signing out in one ends
 * the other at its next action, and the API refuses the old refresh cookie.
 *
 * SMOKE_LONG=1 adds the part that waits past the 15 minutes of the access
 * token (SMOKE_LONG_MINUTES, 16 by default) and uses both tabs afterwards.
 */

/** Every `POST /auth/refresh` of the context, with its status. */
function watchRefreshes(context: BrowserContext): number[] {
  const statuses: number[] = []
  context.on('response', (response: Response) => {
    if (isApiCall('/api/v1/auth/refresh', 'POST')(response)) statuses.push(response.status())
  })
  return statuses
}

async function openPanel(page: Page) {
  await page.goto('/painel')
  await expect(page).toHaveURL(/\/painel/)
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
}

/** An action that needs the token: opening "Expediente", which reads the API. */
async function actInTab(page: Page) {
  const read = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${API}/api/v1/`) &&
      !response.url().startsWith(`${API}/api/v1/auth/`) &&
      response.request().method() === 'GET',
    { timeout: 120_000 },
  )
  await page.getByRole('link', { name: 'Expediente' }).click()
  return read
}

async function signOutAndCheckBoth(
  first: Page,
  second: Page,
  context: BrowserContext,
  request: APIRequestContext,
) {
  const before = (await context.cookies(API)).find((cookie) => cookie.name === REFRESH_COOKIE)
  expect(before, 'cookie antes de sair').toBeDefined()

  await signOut(first)

  // The other tab: its next action ends on /entrar (the session ended there too).
  await second.bringToFront()
  await second.reload()
  await expect(second).toHaveURL(/\/entrar/)
  await expect(second.getByRole('button', { name: 'Entrar como Dono' })).toBeVisible()

  // The API revoked the session: the old cookie no longer renews it (D108, D110).
  const replay = await request.post(`${API}/api/v1/auth/refresh`, {
    headers: {
      Cookie: `${REFRESH_COOKIE}=${before?.value ?? ''}`,
      Origin: SITE,
      'X-Requested-With': 'fetch',
    },
  })
  expect(replay.status(), 'refresh com o cookie de antes do logout').toBe(401)
}

test('item 8: duas abas; recarregar as duas juntas; sair numa encerra a outra', async ({
  page,
  context,
  request,
}) => {
  const refreshes = watchRefreshes(context)
  await signInAsDemo(page, 'Dono')
  const second = await context.newPage()
  await openPanel(second)

  // Both at nearly the same time: only one renews, the other adopts its token.
  await Promise.all([page.reload(), second.reload()])
  for (const tab of [page, second]) {
    await expect(tab).toHaveURL(/\/painel/)
    await expect(tab.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  }
  for (const tab of [page, second]) expect((await actInTab(tab)).status()).toBe(200)
  console.log(`[smoke] item 8: refreshes durante as recargas: ${JSON.stringify(refreshes)}`)
  expect(refreshes.every((status) => status === 200), 'nenhum refresh recusado').toBe(true)

  await signOutAndCheckBoth(page, second, context, request)
})

test('item 8 (SMOKE_LONG): duas abas passam dos 15 minutos do token e continuam logadas', async ({
  page,
  context,
  request,
}) => {
  test.skip(!LONG, 'só com SMOKE_LONG=1')
  const minutes = Number(process.env.SMOKE_LONG_MINUTES ?? '16')
  test.setTimeout((minutes + 6) * 60_000)

  await signInAsDemo(page, 'Dono')
  const second = await context.newPage()
  await openPanel(second)
  const refreshes = watchRefreshes(context)

  console.log(`[smoke] SMOKE_LONG: esperando ${minutes} min sem usar as abas`)
  await page.waitForTimeout(minutes * 60_000)

  // Item 3 on the way: with no other visitor, the API slept after 15 minutes.
  const cold = await context.newPage()
  const started = Date.now()
  const business = cold.waitForResponse(isApiCall(`/api/v1/public/businesses/${DEMO.slug}`, 'GET'), {
    timeout: 120_000,
  })
  await cold.goto(`/n/${DEMO.slug}`)
  expect((await business).status()).toBe(200)
  await expect(cold.getByRole('radiogroup', { name: 'Serviços' })).toBeVisible({ timeout: 120_000 })
  console.log(`[smoke] página pública carregou em ${((Date.now() - started) / 1000).toFixed(1)} s`)
  await cold.close()

  // Both tabs, with the access token expired: each action renews or adopts.
  for (const tab of [page, second]) {
    await tab.bringToFront()
    expect((await actInTab(tab)).status()).toBe(200)
    await expect(tab).toHaveURL(/\/painel/)
  }
  console.log(`[smoke] SMOKE_LONG: refreshes depois da espera: ${JSON.stringify(refreshes)}`)
  expect(refreshes.length, 'o token expirado foi renovado').toBeGreaterThan(0)
  expect(refreshes.every((status) => status === 200), 'nenhum refresh recusado').toBe(true)

  await signOutAndCheckBoth(page, second, context, request)
})
