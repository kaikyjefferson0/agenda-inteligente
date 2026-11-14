import { test as base, expect, type Locator, type Page } from '@playwright/test'

export { expect }

/**
 * `test` of every spec (D117): the preview serves the CSP of production, and a
 * test fails on any violation of it (the `securitypolicyviolation` event), on
 * any error in the console and on any uncaught error of the page, in every
 * page of the test.
 */
export const test = base.extend<{ browserProblems: void }>({
  browserProblems: [
    async ({ context }, use) => {
      const problems: string[] = []
      await context.exposeBinding('__reportCspViolation', (_source, report: string) => {
        problems.push(`violação de CSP: ${report}`)
      })
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const report = (window as unknown as { __reportCspViolation: (report: string) => void })
            .__reportCspViolation
          report(`${event.effectiveDirective} bloqueou ${event.blockedURI || 'inline'} em ${event.sourceFile || event.documentURI}`)
        })
      })
      context.on('console', (message) => {
        if (message.type() === 'error') problems.push(`erro no console: ${message.text()} (${message.location().url})`)
      })
      context.on('weberror', (error) => problems.push(`erro na página: ${error.error().message}`))

      await use()

      expect(problems, 'o navegador registrou problemas durante o teste').toEqual([])
    },
    { auto: true },
  ],
})

/** The demo of the restoration (D43, D44), with the password of docker-compose.e2e.yml. */
export const DEMO = {
  slug: 'barbearia-demo',
  timeZone: 'America/Sao_Paulo',
  password: process.env.E2E_DEMO_PASSWORD ?? 'senha-da-demo-somente-e2e',
  owner: 'dono@demo.example.com',
  professional: 'profissional@demo.example.com',
} as const

/** A time of the picker: its accessible name is just "HH:MM". */
export const SLOT_NAME = /^\d{2}:\d{2}$/

/**
 * The day as `formatLocalDate` prints it ("sexta-feira, 13/11/2026"), for the
 * calendar day of `instant` in the business's time zone, never the browser's.
 */
export function businessDay(instant: Date = new Date()): string {
  const weekday = new Intl.DateTimeFormat('pt-BR', {
    timeZone: DEMO.timeZone,
    weekday: 'long',
  }).format(instant)
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: DEMO.timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant)
  return `${weekday}, ${date}`
}

/**
 * Waits for the times of the day on screen, or for its empty state. The
 * skeleton shows neither, so this returns only once the day has loaded.
 */
export async function waitForSlots(page: Page): Promise<Locator> {
  const slots = page.getByRole('radio', { name: SLOT_NAME })
  await expect(slots.first().or(page.getByText('Sem horários livres neste dia'))).toBeVisible()
  return slots
}
