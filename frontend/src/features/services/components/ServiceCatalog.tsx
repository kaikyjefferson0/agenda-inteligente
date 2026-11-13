import { useQuery } from '@tanstack/react-query'
import { CheckIcon, CircleAlertIcon, EyeOffIcon, InfoIcon, PencilIcon, PlusIcon, RotateCcwIcon, ScissorsIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { PanelPage } from '@/components/layout/PanelPage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { professionalsQuery, servicesQuery } from '@/features/scheduling'
import { formatDuration, formatPrice } from '@/lib/format'

import { useUpdateService } from '../queries'
import { byName, type Service } from '../service-draft'
import { ServiceForm, type ServiceSaved } from './ServiceForm'

export interface ServicesAccount {
  /** RN28: on the demo, names are locked and no service is created. */
  isDemo: boolean
}

type Notice = { tone: 'success' | 'error'; text: string; error?: unknown }

/**
 * UC06 (D90): the catalog of the business. Active services first, the
 * inactive ones in a group of their own, where they can come back. A service
 * is never deleted, because the appointments keep its history: it leaves the
 * public page when deactivated.
 */
export function ServiceCatalog({ account }: { account: ServicesAccount }) {
  const services = useQuery(servicesQuery)
  // The Owner reads the whole team: a service nobody serves is pointed out (RN07).
  const team = useQuery(professionalsQuery)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  const editButtons = useRef(new Map<string, HTMLButtonElement | null>())
  const toggle = useUpdateService()
  const [toggling, setToggling] = useState<string | null>(null)
  // Marked on the click itself, before React redraws: a double click sends once.
  const togglingRef = useRef(false)

  useEffect(() => {
    if (notice !== null) noticeRef.current?.focus()
  }, [notice])

  const servedBy = (service: Service) =>
    (team.data ?? []).filter(
      (professional) => professional.is_active && professional.is_bookable && professional.service_ids.includes(service.id),
    ).length

  const closeForm = (id: string | 'new') => {
    setEditing(null)
    // The button that opened the form takes the focus back, once it is on the screen again.
    requestAnimationFrame(() => (id === 'new' ? newButton.current : editButtons.current.get(id))?.focus())
  }

  const saved = ({ kind, service }: ServiceSaved) => {
    setEditing(null)
    if (kind === 'unchanged') {
      requestAnimationFrame(() => editButtons.current.get(service.id)?.focus())
      return
    }
    setNotice({
      tone: 'success',
      text:
        kind === 'created'
          ? `${service.name} criado. Escolha em Equipe quem faz este serviço para ele aparecer na página pública.`
          : `${service.name} salvo. Os agendamentos já marcados mantêm a duração e o preço de quando foram feitos.`,
    })
  }

  const setActive = async (service: Service, active: boolean) => {
    if (togglingRef.current) return
    togglingRef.current = true
    setToggling(service.id)
    try {
      await toggle.mutateAsync({ id: service.id, changes: { is_active: active } })
      setNotice({
        tone: 'success',
        text: active
          ? `${service.name} reativado. Ele volta à página pública para quem o atende.`
          : `${service.name} desativado. Ele saiu da página pública; os agendamentos já marcados continuam.`,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        text: active ? `Não foi possível reativar ${service.name}` : `Não foi possível desativar ${service.name}`,
        error,
      })
    } finally {
      togglingRef.current = false
      setToggling(null)
    }
  }

  const list = [...(services.data ?? [])].sort(byName)
  const active = list.filter((service) => service.is_active)
  const inactive = list.filter((service) => !service.is_active)
  const busy = editing !== null || toggling !== null

  const row = (service: Service) => {
    if (editing === service.id) {
      return (
        <li key={service.id} className="bg-accent/40 p-4">
          <ServiceForm
            service={service}
            isDemo={account.isDemo}
            onSaved={saved}
            onCancel={() => closeForm(service.id)}
          />
        </li>
      )
    }
    const nobody = service.is_active && team.isSuccess && servedBy(service) === 0
    return (
      <li key={service.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-base font-semibold text-pretty">{service.name}</h3>
            {service.is_active ? null : (
              <Badge variant="secondary" className="h-6 gap-1 px-2 text-xs">
                <EyeOffIcon aria-hidden="true" />
                Inativo
              </Badge>
            )}
          </div>
          <p className="text-[0.9375rem] text-muted-foreground">
            <span className="tabular-nums">{formatDuration(service.duration_minutes)}</span>
            {service.preparation_minutes > 0 ? (
              <>
                {' '}
                + <span className="tabular-nums">{formatDuration(service.preparation_minutes)}</span> de preparo
              </>
            ) : (
              ', sem preparo'
            )}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            <span className="font-medium text-foreground tabular-nums">{formatPrice(service.price_cents)}</span>
          </p>
          {nobody ? (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Ninguém da equipe faz este serviço: na página pública, ele aparece sem horários.
            </p>
          ) : null}
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
          <Button
            ref={(element) => {
              editButtons.current.set(service.id, element)
            }}
            type="button"
            variant="outline"
            className="h-11 px-3 text-[0.9375rem] md:h-9"
            disabled={busy}
            aria-label={`Editar ${service.name}`}
            onClick={() => {
              setNotice(null)
              setEditing(service.id)
            }}
          >
            <PencilIcon aria-hidden="true" />
            Editar
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 px-3 text-[0.9375rem] md:h-9"
            disabled={busy}
            aria-label={service.is_active ? `Desativar ${service.name}` : `Reativar ${service.name}`}
            onClick={() => void setActive(service, !service.is_active)}
          >
            {toggling === service.id ? (
              <Spinner aria-hidden="true" />
            ) : service.is_active ? (
              <EyeOffIcon aria-hidden="true" />
            ) : (
              <RotateCcwIcon aria-hidden="true" />
            )}
            {service.is_active ? 'Desativar' : 'Reativar'}
          </Button>
        </div>
      </li>
    )
  }

  // On the demo there is no creating (RN28): the notice says so, without a dead button.
  const newAction = account.isDemo ? undefined : (
    <Button
      ref={newButton}
      type="button"
      size="lg"
      className="h-11 w-full px-5 text-base sm:w-auto"
      disabled={busy || !services.isSuccess}
      onClick={() => {
        setNotice(null)
        setEditing('new')
      }}
    >
      <PlusIcon aria-hidden="true" className="size-5" />
      Novo serviço
    </Button>
  )

  let body
  if (services.isPending) {
    body = (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    )
  } else if (services.isError) {
    body = (
      <ErrorMessage
        error={services.error}
        title="Não foi possível carregar os serviços"
        onRetry={() => void services.refetch()}
      />
    )
  } else {
    body = (
      <>
        {editing === 'new' ? (
          <section aria-labelledby="servico-novo-titulo" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
            <h2 id="servico-novo-titulo" className="text-xl leading-tight font-semibold sm:text-2xl">
              Novo serviço
            </h2>
            <ServiceForm isDemo={account.isDemo} onSaved={saved} onCancel={() => closeForm('new')} />
          </section>
        ) : null}

        {list.length === 0 && editing !== 'new' ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ScissorsIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Nenhum serviço ainda</EmptyTitle>
              <EmptyDescription>
                Crie o primeiro serviço, com duração, preparo e preço, para os clientes agendarem pela página pública.
              </EmptyDescription>
            </EmptyHeader>
            {account.isDemo ? null : (
              <EmptyContent>
                <Button type="button" size="lg" className="h-11 px-5 text-base" onClick={() => setEditing('new')}>
                  <PlusIcon aria-hidden="true" className="size-5" />
                  Criar serviço
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : null}

        {active.length > 0 ? (
          <section aria-labelledby="servicos-ativos" className="flex flex-col gap-3">
            <h2 id="servicos-ativos" className="text-lg font-semibold">
              Ativos <span className="font-normal text-muted-foreground tabular-nums">({active.length})</span>
            </h2>
            <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">{active.map(row)}</ul>
          </section>
        ) : null}

        {inactive.length > 0 ? (
          <section aria-labelledby="servicos-inativos" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="servicos-inativos" className="text-lg font-semibold">
                Inativos <span className="font-normal text-muted-foreground tabular-nums">({inactive.length})</span>
              </h2>
              <p className="text-sm text-muted-foreground">
                Fora da página pública. Os agendamentos que já tinham continuam na agenda.
              </p>
            </div>
            <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">{inactive.map(row)}</ul>
          </section>
        ) : null}
      </>
    )
  }

  return (
    <PanelPage
      title="Serviços"
      description="O que o negócio oferece, com duração, preparo e preço. Um serviço com histórico não é excluído: ele é desativado e sai da página pública."
      action={newAction}
    >
      {account.isDemo ? (
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertTitle>Negócio de demonstração</AlertTitle>
          <AlertDescription>
            Os nomes dos serviços ficam travados e não é possível criar serviços, para que a demonstração não sirva para
            enviar textos a terceiros. Duração, preparo, preço e situação podem ser alterados.
          </AlertDescription>
        </Alert>
      ) : null}

      {notice !== null ? (
        <div ref={noticeRef} tabIndex={-1}>
          {notice.tone === 'error' ? (
            <ErrorMessage error={notice.error} title={notice.text} />
          ) : (
            <div role="status" className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
                <CheckIcon aria-hidden="true" className="size-4" strokeWidth={2.5} />
              </span>
              <p className="font-medium text-pretty">{notice.text}</p>
            </div>
          )}
        </div>
      ) : null}

      {body}

      {services.isSuccess && team.isError ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Não foi possível conferir quem da equipe faz cada serviço.
        </p>
      ) : null}
    </PanelPage>
  )
}
