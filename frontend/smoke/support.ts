import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'

export { expect }

/**
 * Smoke test of production (docs/deploy.md, step 10). Runs against real URLs,
 * never in CI: `npm run test:smoke` (see smoke/README.md).
 *
 * It reads no secret. The demo shortcut of /entrar carries its own password,
 * built into the public JavaScript of the site (D75).
 */

function origin(value: string): string {
  return value.replace(/\/+$/, '')
}

export const SITE = origin(process.env.SMOKE_BASE_URL ?? 'https://agenda.kaikyjefferson.dev')
export const API = origin(process.env.SMOKE_API_URL ?? 'https://api-agenda.kaikyjefferson.dev')

/** Opt-in parts: the 15-minute wait (item 8) and the login lockout (item 10). */
export const LONG = process.env.SMOKE_LONG === '1'
export const RATE_LIMIT = process.env.SMOKE_RATE_LIMIT === '1'

export const DEMO = {
  slug: 'barbearia-demo',
  owner: 'dono@demo.example.com',
  professional: 'profissional@demo.example.com',
} as const

export const REFRESH_COOKIE = '__Host-refresh_token'

/** A time of the picker: its accessible name is just "HH:MM". */
export const SLOT_NAME = /^\d{2}:\d{2}$/

/** The calls of the browser to the API (any method), by path. */
export function isApiCall(path: string, method?: string) {
  return (response: { url(): string; request(): { method(): string } }) =>
    response.url().split('?')[0] === `${API}${path}` &&
    (method === undefined || response.request().method() === method)
}

/**
 * Item 9 on every test that opens a browser: any CSP violation (the
 * `securitypolicyviolation` event), any console message with "Refused to" or
 * "Content Security Policy" (of any level), any console error and any uncaught
 * error of a page fail the test, in every page of its context.
 */
export const test = base.extend<{ browserProblems: string[] }>({
  browserProblems: [
    async ({ context }, use) => {
      const problems: string[] = []
      await context.exposeBinding('__smokeCspViolation', (_source, report: string) => {
        problems.push(`violação de CSP: ${report}`)
      })
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const report = (window as unknown as { __smokeCspViolation: (report: string) => void })
            .__smokeCspViolation
          report(
            `${event.effectiveDirective} bloqueou ${event.blockedURI || 'inline'} em ${event.sourceFile || event.documentURI}`,
          )
        })
      })
      context.on('console', (message) => {
        const text = message.text()
        const where = message.location().url
        if (/Refused to|Content Security Policy/i.test(text)) {
          problems.push(`CSP no console (${message.type()}): ${text} (${where})`)
        } else if (message.type() === 'error') {
          problems.push(`erro no console: ${text} (${where})`)
        }
      })
      context.on('weberror', (error) => problems.push(`erro na página: ${error.error().message}`))

      await use(problems)

      expect(problems, 'item 9: o navegador registrou problemas nesta tela').toEqual([])
    },
    { auto: true },
  ],
})

/** /entrar, the demo shortcut, and the panel with the agenda. */
export async function signInAsDemo(page: Page, role: 'Dono' | 'Profissional') {
  await page.goto('/entrar')
  const login = page.waitForResponse(isApiCall('/api/v1/auth/login', 'POST'))
  await page.getByRole('button', { name: `Entrar como ${role}` }).click()
  expect((await login).status(), `login como ${role}`).toBe(200)
  await expect(page).toHaveURL(/\/painel$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
}

/** "Sair" in the side menu, back to /entrar. */
export async function signOut(page: Page) {
  const logout = page.waitForResponse(isApiCall('/api/v1/auth/logout', 'POST'))
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  expect((await logout).status(), 'logout').toBeLessThan(300)
  await expect(page).toHaveURL(/\/entrar$/)
}

/** The server clock, from the `Date` header of `/health`. */
export async function serverNow(request: APIRequestContext): Promise<Date> {
  const response = await request.get(`${API}/health`)
  const date = response.headers()['date']
  return date === undefined ? new Date() : new Date(date)
}
