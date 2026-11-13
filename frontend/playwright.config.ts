import { defineConfig, devices } from '@playwright/test'

const CI = Boolean(process.env.CI)

/**
 * End-to-end tests (D102 to D104). The system comes up through `npm run
 * test:e2e` (e2e/run.mjs), on ports of its own: 5175 for the frontend (the
 * production build) and 8003 for the API.
 */
export default defineConfig({
  testDir: './e2e',
  // One worker: the bookings of two tests would race for the same time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  // D104: in CI one retry, only to tell "always broken" from "flaky"; a test
  // that passes only on the retry still fails the job.
  retries: CI ? 1 : 0,
  failOnFlakyTests: CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5175',
    // D103: far from the business (America/Sao_Paulo), as in the Vitest tests.
    timezoneId: 'Asia/Tokyo',
    locale: 'pt-BR',
    // Kept for every failed attempt, the first one and the retry alike.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'celular',
      // Chromium emulating a 390 px phone, with touch.
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
})
