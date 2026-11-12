import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { PageLoader } from '@/components/feedback/PageLoader'

import { meQuery } from '../queries'
import { PANEL_HOME } from '../return-to'

/**
 * Pages of the Owner (D74): a Professional who opens one by its address goes
 * back to the panel. Hiding them is comfort; the API is what refuses access.
 */
export function RequireOwner({ children }: { children: ReactNode }) {
  const me = useQuery(meQuery)

  if (me.isPending) return <PageLoader />
  if (me.isError) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <ErrorMessage error={me.error} onRetry={() => void me.refetch()} />
      </div>
    )
  }
  if (me.data.user.role !== 'owner') return <Navigate to={PANEL_HOME} replace />
  return children
}
