import { API } from './support.ts'

/**
 * Cold start (D112): the free API sleeps after 15 minutes without visits and
 * takes about a minute to wake up. Waits for `/health` (which does not touch
 * the database) before any test, up to SMOKE_WARMUP_SECONDS (90 by default).
 */
export default async function waitForApi() {
  const limitSeconds = Number(process.env.SMOKE_WARMUP_SECONDS ?? '90')
  const started = Date.now()
  const deadline = started + limitSeconds * 1000
  let last = 'sem resposta'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API}/health`, {
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      })
      if (response.ok) {
        const seconds = ((Date.now() - started) / 1000).toFixed(1)
        console.log(`[smoke] ${API}/health respondeu ${response.status} em ${seconds} s`)
        return
      }
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  throw new Error(`[smoke] ${API}/health não respondeu em ${limitSeconds} s (último: ${last})`)
}
