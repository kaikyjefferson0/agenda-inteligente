import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { meQuery, useLogout, type UserRole } from './queries'
import { LOGIN_PATH, loginPath } from './return-to'
import { useSession } from './use-session'

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Dono',
  professional: 'Profissional',
}

/**
 * What the panel shows of the session: who is in, the role (D74) and the
 * logout. When the session ends, here or in another tab, it leaves the panel:
 * after "Sair" to `/entrar`; otherwise with the page to come back to.
 */
export function usePanelAccount() {
  const session = useSession()
  const me = useQuery({ ...meQuery, enabled: session.status === 'authenticated' })
  const logout = useLogout()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (session.status !== 'anonymous') return
    const target =
      session.reason === 'logout' ? LOGIN_PATH : loginPath(`${location.pathname}${location.search}`)
    void navigate(target, { replace: true })
  }, [session, location.pathname, location.search, navigate])

  const data = me.data
  return {
    account:
      data === undefined
        ? null
        : {
            userName: data.user.name,
            businessName: data.business.name,
            roleLabel: ROLE_LABELS[data.user.role],
            isOwner: data.user.role === 'owner',
          },
    logout: () => logout.mutate(),
    loggingOut: logout.isPending,
  }
}
