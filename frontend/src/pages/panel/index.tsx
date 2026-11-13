// Panel group (D54): loaded on demand as one chunk, together with its layout.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { PanelLayout } from '@/components/layout/PanelLayout'
import { PanelPageError, PanelPageLoading } from '@/components/layout/PanelPageState'
import { meQuery, RequireOwner, usePanelAccount } from '@/features/auth'
import { BusinessSettings } from '@/features/business-settings'
import { ServiceCatalog } from '@/features/services'
import { TeamManager } from '@/features/team'
import { TeamAgenda } from '@/features/team-agenda'
import { TimeBlocks, WorkingHours, type ScheduleAccount } from '@/features/work-schedule'

/** The panel with who is in and the logout (UC02). */
export function ProtectedPanelLayout() {
  const { account, logout, loggingOut, sessionActive } = usePanelAccount()
  return <PanelLayout account={account} onLogout={logout} loggingOut={loggingOut} sessionActive={sessionActive} />
}

/** UC15 to UC18: the page reads who is in and hands it to the agenda (D66, D79). */
export function AgendaPage() {
  const me = useQuery(meQuery)
  if (me.data === undefined) {
    return me.isError ? (
      <PanelPageError title="Agenda" wide error={me.error} onRetry={() => void me.refetch()} />
    ) : (
      <PanelPageLoading title="Agenda" wide />
    )
  }
  return (
    <TeamAgenda
      account={{
        userId: me.data.user.id,
        isOwner: me.data.user.role === 'owner',
        timeZone: me.data.business.timezone,
      }}
    />
  )
}

/** UC06, only for the Owner (D74, D90). */
export function ServicesPage() {
  return (
    <RequireOwner title="Serviços">
      <WithAccount title="Serviços">{(account) => <ServiceCatalog account={account} />}</WithAccount>
    </RequireOwner>
  )
}

/** UC04 and UC07, only for the Owner (D74, D91). */
export function TeamPage() {
  return (
    <RequireOwner title="Equipe">
      <WithAccount title="Equipe">{(account) => <TeamManager account={account} />}</WithAccount>
    </RequireOwner>
  )
}

/** What a page of the panel hands to its feature: each one takes the part it needs. */
interface PanelAccount extends ScheduleAccount {
  isDemo: boolean
}

/**
 * Who is in, for a page of the panel: the page reads `GET /auth/me` and hands
 * it to the feature (D66, D79), which never imports from `auth`.
 */
function WithAccount({
  title,
  children,
}: {
  title: string
  children: (account: PanelAccount) => ReactNode
}) {
  const me = useQuery(meQuery)
  if (me.data === undefined) {
    return me.isError ? (
      <PanelPageError title={title} error={me.error} onRetry={() => void me.refetch()} />
    ) : (
      <PanelPageLoading title={title} />
    )
  }
  return children({
    userId: me.data.user.id,
    isOwner: me.data.user.role === 'owner',
    timeZone: me.data.business.timezone,
    isDemo: me.data.business.is_demo,
  })
}

/** UC08 (D74): a Professional edits the own week; the Owner picks whose. */
export function WorkingHoursPage() {
  return <WithAccount title="Expediente">{(account) => <WorkingHours account={account} />}</WithAccount>
}

/** UC09 (D74): a Professional manages the own blocks; the Owner picks whose. */
export function TimeBlocksPage() {
  return <WithAccount title="Bloqueios">{(account) => <TimeBlocks account={account} />}</WithAccount>
}

/**
 * UC05, only for the Owner (D74, D92). The name, the slug and the time zone of
 * the session come from `GET /auth/me`: saving reads it again (D93).
 */
export function BusinessSettingsPage() {
  const queryClient = useQueryClient()
  return (
    <RequireOwner title="Negócio">
      <BusinessSettings onSaved={() => void queryClient.invalidateQueries({ queryKey: meQuery.queryKey })} />
    </RequireOwner>
  )
}
