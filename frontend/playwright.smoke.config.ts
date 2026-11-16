import { defineConfig, devices } from '@playwright/test'

import { SITE } from './smoke/support.ts'

/**
 * Smoke test of production (docs/deploy.md, step 10): `npm run test:smoke`.
 * Apart from the E2E suite (playwright.config.ts, which only reads ./e2e) and
 * out of CI. See smoke/README.md for the variables.
 */
export default defineConfig({
  testDir: './smoke',
  testMatch: '**/*.smoke.ts',
  // Files in name order, one at a time: the login lockout (99-...) is the last.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  // Never retried: a retry would book a second appointment.
  retries: 0,
  // Waits for the API to wake up before any test (cold start).
  globalSetup: './smoke/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: './test-results/smoke',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report/smoke' }]],
  use: {
    baseURL: SITE,
    timezoneId: 'America/Sao_Paulo',
    locale: 'pt-BR',
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'producao',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
})
