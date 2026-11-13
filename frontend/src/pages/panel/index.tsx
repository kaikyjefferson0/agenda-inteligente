// Panel group (D54): loaded on demand as one chunk, together with its layout.
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { PageLoader } from '@/components/feedback/PageLoader'
import { PanelLayout } from '@/components/layout/PanelLayout'
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'
import { meQuery, RequireOwner, usePanelAccount } from '@/features/auth'
import { TeamAgenda } from '@/features/team-agenda'
import { TimeBlocks, WorkingHours, type ScheduleAccount } from '@/features/work-schedule'

/** The panel with who is in and the logout (UC02). */
export function ProtectedPanelLayout() {
  const { account, logout, loggingOut } = usePanelAccount()
  return <PanelLayout account={account} onLogout={logout} loggingOut={loggingOut} />
}

/** UC15 to UC18: the page reads who is in and hands it to the agenda (D66, D79). */
export function AgendaPage() {
  const me = useQuery(meQuery)
  if (me.data === undefined) {
    return me.isError ? (
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
        <ErrorMessage
          error={me.error}
          title="Não foi possível abrir a agenda"
          onRetry={() => void me.refetch()}
        />
      </section>
    ) : (
      <PageLoader />
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

export function ServicesPage() {
  return (
    <RequireOwner>
      <PlaceholderPage
        title="Serviços"
        description="Aqui o Dono vai criar, editar e desativar serviços, com duração, preparo e preço."
      />
    </RequireOwner>
  )
}

export function TeamPage() {
  return (
    <RequireOwner>
      <PlaceholderPage
        title="Equipe"
        description="Aqui o Dono vai convidar e desativar profissionais e escolher os serviços de cada um."
      />
    </RequireOwner>
  )
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
  children: (account: ScheduleAccount) => ReactNode
}) {
  const me = useQuery(meQuery)
  if (me.data === undefined) {
    return me.isError ? (
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <ErrorMessage
          error={me.error}
          title={`Não foi possível abrir ${title.toLocaleLowerCase('pt-BR')}`}
          onRetry={() => void me.refetch()}
        />
      </section>
    ) : (
      <PageLoader />
    )
  }
  return children({
    userId: me.data.user.id,
    isOwner: me.data.user.role === 'owner',
    timeZone: me.data.business.timezone,
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

export function BusinessSettingsPage() {
  return (
    <RequireOwner>
      <PlaceholderPage
        title="Negócio"
        description="Aqui o Dono vai alterar nome, endereço, fuso, passo da grade, antecedência e prazo de alteração."
      />
    </RequireOwner>
  )
}
