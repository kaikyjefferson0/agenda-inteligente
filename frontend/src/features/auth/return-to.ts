/**
 * `?voltar=` of the login page (D73): only an address of the panel, so the
 * login never sends anyone to another site (open redirect) or to a page that
 * does not need it.
 */

export const PANEL_HOME = '/painel'
export const LOGIN_PATH = '/entrar'
export const RETURN_PARAM = 'voltar'

const PANEL_PATH = /^\/painel(?:[/?#]|$)/

export function safeReturnTo(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return PANEL_HOME
  if (!PANEL_PATH.test(raw)) return PANEL_HOME
  // `//`, `\` and control characters could turn into another origin.
  if (raw.includes('//') || raw.includes('\\') || /\p{Cc}/u.test(raw)) return PANEL_HOME
  return raw
}

/** `/entrar`, with the page to return to when it is not the panel home. */
export function loginPath(returnTo?: string): string {
  const target = safeReturnTo(returnTo)
  if (returnTo === undefined || target === PANEL_HOME) return LOGIN_PATH
  return `${LOGIN_PATH}?${RETURN_PARAM}=${encodeURIComponent(target)}`
}
