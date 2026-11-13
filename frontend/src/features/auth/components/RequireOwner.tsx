import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router'

import { PanelPageError, PanelPageLoading } from '@/components/layout/PanelPageState'

import { meQuery } from '../queries'
import { PANEL_HOME } from '../return-to'

/**
 * Pages of the Owner (D74): a Professional who opens one by its address goes
 * back to the panel. Hiding them is comfort; the API is what refuses access.
 */
export function RequireOwner({ title, children }: { title: string; children: ReactNode }) {
  const me = useQuery(meQuery)

  // The same frame as the page while it reads who is in: no spinner before the skeleton.
  if (me.isPending) return <PanelPageLoading title={title} />
  if (me.isError) return <PanelPageError title={title} error={me.error} onRetry={() => void me.refetch()} />
  if (me.data.user.role !== 'owner') return <Navigate to={PANEL_HOME} replace />
  return children
}
