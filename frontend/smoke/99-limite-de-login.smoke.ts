import { API, expect, RATE_LIMIT, serverNow, test } from './support.ts'

/**
 * Item 10 of step 10, only the current network: 11 wrong logins for an e-mail
 * that does not exist give 401 ten times and 429 on the 11th
 * (LOGIN_BY_IP_AND_EMAIL: 10 per 15 minutes, per IP and e-mail).
 *
 * Only with SMOKE_RATE_LIMIT=1, and the last file of the run. The windows are
 * fixed and aligned to the clock (:00, :15, :30 and :45), so the lockout of
 * this IP and e-mail lasts until the end of the current window: up to 15
 * minutes, and the `Retry-After` of the 429 says exactly how long. The demo
 * accounts are not locked (another e-mail), but the 11 attempts also count
 * towards the 50 logins per IP in the same window (LOGIN_BY_IP).
 */

const WINDOW_MS = 15 * 60_000
/** The 11 requests must fit in one window: closer to its end, wait for the next. */
const MARGIN_MS = 45_000

test('item 10: 10 vezes 401 e 429 na 11ª tentativa de login', async ({ request }) => {
  test.skip(!RATE_LIMIT, 'só com SMOKE_RATE_LIMIT=1 (bloqueia este IP e e-mail por até 15 min)')
  test.setTimeout(3 * 60_000)

  const now = await serverNow(request)
  const left = WINDOW_MS - (now.getTime() % WINDOW_MS)
  if (left < MARGIN_MS) {
    console.log(`[smoke] item 10: esperando ${Math.ceil(left / 1000) + 2} s pela próxima janela`)
    await new Promise((resolve) => setTimeout(resolve, left + 2000))
  }

  // An e-mail of its own on each run, so an earlier run (or the curl of the
  // guide) in the same window does not count.
  const email = `smoke-limite-${Date.now()}@example.com`
  const statuses: number[] = []
  let retryAfter: string | undefined
  for (let attempt = 1; attempt <= 11; attempt += 1) {
    const response = await request.post(`${API}/api/v1/auth/login`, {
      data: { email, password: 'senha-errada-123' },
    })
    statuses.push(response.status())
    if (response.status() === 429) retryAfter = response.headers()['retry-after']
  }
  console.log(`[smoke] item 10: ${statuses.join(' ')}; Retry-After: ${retryAfter ?? '-'} s`)
  expect(statuses).toEqual([...Array<number>(10).fill(401), 429])
  expect(Number(retryAfter)).toBeGreaterThan(0)
  expect(Number(retryAfter)).toBeLessThanOrEqual(900)
})
