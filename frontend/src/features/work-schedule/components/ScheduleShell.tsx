import { useQuery } from '@tanstack/react-query'
import { UsersIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { DiscardChangesDialog } from '@/components/feedback/DiscardChangesDialog'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { SelectField, servicesQuery, type Professional } from '@/features/scheduling'
import { timeZoneName } from '@/lib/timezone-name'

import { useScheduleProfessional, type ScheduleAccount } from '../use-schedule-professional'

interface ScheduleShellProps {
  title: string
  description: string
  account: ScheduleAccount
  /** Unsaved changes: switching professional asks before throwing them away. */
  dirty?: boolean
  children: (professional: Professional) => ReactNode
}

/**
 * The frame of the working hours and of the blocks: the title, the time zone
 * every time on the page is in (D56) and, for the Owner, whose schedule it is
 * (D74). The content is keyed by the professional, so switching starts it
 * again with the data of the other one.
 */
export function ScheduleShell({ title, description, account, dirty = false, children }: ScheduleShellProps) {
  const { query, options, own, selected, select } = useScheduleProfessional(account)
  const [pending, setPending] = useState<string | null>(null)
  // The lists of appointments name the service from the catalog: read it ahead.
  useQuery(servicesQuery)

  const choose = (id: string) => {
    if (id === selected?.id) return
    if (dirty) setPending(id)
    else select(id)
  }
  const pendingName = options.find((professional) => professional.id === pending)?.name

  let body: ReactNode
  if (query.isPending) {
    body = (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-11 w-full sm:max-w-xs" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  } else if (query.isError) {
    body = (
      <ErrorMessage
        error={query.error}
        title="Não foi possível carregar a equipe"
        onRetry={() => void query.refetch()}
      />
    )
  } else if (selected === null) {
    body = (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{account.isOwner ? 'Ninguém atende ainda' : 'Sem cadastro de profissional'}</EmptyTitle>
          <EmptyDescription>
            {account.isOwner
              ? 'Convide um profissional em Equipe, ou passe a atender, para definir expediente e bloqueios.'
              : 'Sua conta não tem um cadastro de profissional. Fale com o dono do negócio.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    body = (
      <>
        {account.isOwner ? (
          <div className="sm:max-w-xs">
            <SelectField
              id="profissional"
              label="Profissional"
              value={selected.id}
              onValueChange={choose}
              placeholder="Escolha o profissional"
              options={options.map((professional) => ({
                value: professional.id,
                label: professional.id === own?.id ? `${professional.name} (você)` : professional.name,
              }))}
            />
          </div>
        ) : null}
        <div key={selected.id} className="flex flex-col gap-6">
          {children(selected)}
        </div>
      </>
    )
  }

  return (
    <section
      aria-labelledby="agenda-config-titulo"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-5 pb-8 lg:px-6 lg:pt-6"
    >
      <title>{`${title} | Agenda Inteligente`}</title>
      <header className="flex flex-col gap-1">
        <h1 id="agenda-config-titulo" className="text-2xl font-semibold tracking-tight lg:text-3xl">
          {title}
        </h1>
        <p className="max-w-prose text-[0.9375rem] text-pretty text-muted-foreground">
          {description} Horários no fuso do negócio ({timeZoneName(account.timeZone)}).
        </p>
      </header>
      {body}

      <DiscardChangesDialog
        open={pending !== null}
        title="Descartar as alterações?"
        description={`O expediente de ${selected?.name ?? ''} tem alterações que não foram salvas. Ao abrir o de ${pendingName ?? ''}, elas se perdem.`}
        confirmLabel="Descartar e trocar"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending !== null) select(pending)
          setPending(null)
        }}
      />
    </section>
  )
}
