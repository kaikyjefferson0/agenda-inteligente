import { redirect, type LoaderFunctionArgs } from 'react-router'

import { loginPath } from './return-to'
import { getAppSession } from './session/session'

/**
 * Loader of the panel group: waits for the silent renewal and, without a
 * session, goes to `/entrar` with the page asked for (D73).
 */
export async function requireSession({ request }: LoaderFunctionArgs): Promise<null> {
  const session = getAppSession()
  await session.start()
  if (session.getState().status !== 'authenticated') {
    const url = new URL(request.url)
    throw redirect(loginPath(`${url.pathname}${url.search}`))
  }
  return null
}
