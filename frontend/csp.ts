/**
 * Content-Security-Policy of the site (D117), kept in one place.
 *
 * - `vite preview` serves it (vite.config.ts), so the E2E runs the production
 *   build under the production policy and fails on any violation.
 * - The `headers` of the site in `render.yaml` must carry exactly this value.
 *
 * `style-src` allows `'unsafe-inline'` because Radix locks the page scroll
 * (Dialog, AlertDialog, Sheet, Select, menus) with a `<style>` tag whose
 * values are computed at run time: no fixed hash fits it, and a static site
 * has no nonce. Inline style is a small risk next to inline script, which
 * stays blocked (`script-src 'self'`).
 */

/** The origin of `VITE_API_BASE_URL` in production (D116). */
export const PRODUCTION_API_ORIGIN = 'https://api-agenda.kaikyjefferson.dev'

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  `connect-src 'self' ${PRODUCTION_API_ORIGIN}; ` +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "frame-ancestors 'none'"

/**
 * Checks `VITE_API_BASE_URL` for a build: empty (the API on the same origin,
 * as in the E2E) or an origin, without path or trailing slash (the paths of
 * the client already start with `/api/v1`), allowed by `connect-src`.
 * Returns the problem, or `null` when the value is fine.
 */
export function apiBaseUrlProblem(value: string | undefined): string | null {
  if (value === undefined || value === '') return null
  let origin: string
  try {
    origin = new URL(value).origin
  } catch {
    return `VITE_API_BASE_URL não é um endereço: "${value}"`
  }
  if (origin !== value) {
    return `VITE_API_BASE_URL deve ser só a origem, sem caminho nem barra no fim: use "${origin}"`
  }
  const connectSrc = CONTENT_SECURITY_POLICY.split('; ')
    .find((directive) => directive.startsWith('connect-src '))!
    .split(' ')
  if (!connectSrc.includes(origin)) {
    return `VITE_API_BASE_URL (${origin}) não está no connect-src da CSP, em frontend/csp.ts`
  }
  return null
}
