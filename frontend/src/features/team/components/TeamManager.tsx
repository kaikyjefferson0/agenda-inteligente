import { useQuery } from '@tanstack/react-query'
import {
  BanIcon,
  CheckIcon,
  CircleAlertIcon,
  Clock3Icon,
  InfoIcon,
  ListChecksIcon,
  MailIcon,
  UserCheckIcon,
  UserPlusIcon,
  UsersIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { PATHS } from '@/app/router'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { PanelPage } from '@/components/layout/PanelPage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  AppointmentLinks,
  ownProfessional,
  professionalsQuery,
  servicesQuery,
  type Professional,
  type ScheduledAppointment,
} from '@/features/scheduling'
import { useRetryAfter } from '@/hooks/use-retry-after'
import { formatDateTime } from '@/lib/datetime'

import { useInvite, useStartServing } from '../queries'
import { situationOf, SITUATION_LABELS, teamOrder, type Situation } from '../situation'
import { CancelInvitationDialog, type CancelInvitationResult } from './CancelInvitationDialog'
import { DeactivateDialog, type DeactivateResult } from './DeactivateDialog'
import { InviteForm } from './InviteForm'
import { MemberServices } from './MemberServices'

export interface TeamAccount {
  userId: string
  /** RN28: on the demo, invites are off. */
  isDemo: boolean
  /** IANA time zone of the business (D56). */
  timeZone: string
}

type Notice =
  | { kind: 'success'; text: ReactNode }
  | { kind: 'error'; title: string; error: unknown }
  | { kind: 'info'; title: string; text: string }
  | { kind: 'conflicts'; professional: Professional; isOwner: boolean; appointments: ScheduledAppointment[] }

const SITUATION_ICONS: Record<Situation, typeof CheckIcon> = {
  active: UserCheckIcon,
  pending: Clock3Icon,
  deactivated: BanIcon,
  'owner-serving': UserCheckIcon,
  'owner-not-serving': BanIcon,
}

const SITUATION_VARIANTS: Record<Situation, string> = {
  active: 'bg-success-soft text-success-soft-foreground',
  'owner-serving': 'bg-success-soft text-success-soft-foreground',
  pending: 'bg-accent text-accent-foreground',
  deactivated: 'bg-muted text-muted-foreground',
  'owner-not-serving': 'bg-muted text-muted-foreground',
}

/**
 * UC04 and UC07 (D91): who is in the team and where each one stands, the
 * invite, "Também atendo" for the Owner, the deactivation and the services of
 * each one. Only for the Owner (D74).
 */
export function TeamManager({ account }: { account: TeamAccount }) {
  const team = useQuery(professionalsQuery)
  const services = useQuery(servicesQuery)
  const startServing = useStartServing()
  const renew = useInvite()
  const retry = useRetryAfter()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [renewing, setRenewing] = useState<string | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  // Marked on the click itself, before React redraws: a double click sends once.
  const busyRef = useRef(false)
  const servicesButtons = useRef(new Map<string, HTMLButtonElement | null>())

  useEffect(() => {
    if (notice !== null) noticeRef.current?.focus()
  }, [notice])

  const members = [...(team.data ?? [])].sort(teamOrder(account.userId))
  const own = team.data === undefined ? null : ownProfessional(account.userId, team.data)
  const current = members.filter((member) => situationOf(member, account.userId) !== 'deactivated')
  const gone = members.filter((member) => situationOf(member, account.userId) === 'deactivated')
  const serviceNames = (member: Professional) =>
    (services.data ?? [])
      .filter((service) => member.service_ids.includes(service.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map((service) => (service.is_active ? service.name : `${service.name} (inativo)`))

  const serve = async () => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const professional = await startServing.mutateAsync()
      setNotice({
        kind: 'success',
        text: (
          <>
            Você voltou às reservas como profissional.{' '}
            {professional.service_ids.length === 0 ? 'Escolha seus serviços abaixo e ' : 'Confira '}
            <Link to={`${PATHS.panel}/expediente`} className="font-medium">
              seu expediente
            </Link>
            .
          </>
        ),
      })
    } catch (error) {
      setNotice({ kind: 'error', title: 'Não foi possível passar a atender', error })
    } finally {
      busyRef.current = false
    }
  }

  const resend = async (member: Professional) => {
    if (busyRef.current || retry.holding()) return
    busyRef.current = true
    setRenewing(member.id)
    try {
      const invitation = await renew.mutateAsync({ name: member.name, email: member.email })
      setNotice({
        kind: 'success',
        text: `Convite reenviado para ${invitation.email}. O novo link vale até ${formatDateTime(invitation.expires_at, account.timeZone)}; o anterior deixou de valer.`,
      })
    } catch (error) {
      retry.holdFor(error)
      setNotice({ kind: 'error', title: `Não foi possível reenviar o convite de ${member.name}`, error })
    } finally {
      busyRef.current = false
      setRenewing(null)
    }
  }

  const deactivated = (member: Professional, isOwner: boolean, result: DeactivateResult) => {
    if (result.kind === 'conflicts') {
      setNotice({ kind: 'conflicts', professional: member, isOwner, appointments: result.appointments })
    } else if (result.kind === 'gone') {
      setNotice({ kind: 'error', title: `${member.name} não está mais na equipe`, error: null })
    } else {
      setNotice({
        kind: 'success',
        text: isOwner
          ? 'Você saiu das novas reservas. Para voltar, use “Também atendo”.'
          : `${member.name} foi desativado: perdeu o acesso e saiu das novas reservas.`,
      })
    }
  }

  const cancelled = (member: Professional, result: CancelInvitationResult) => {
    if (result.kind === 'done') {
      setNotice({
        kind: 'success',
        text: `Convite de ${member.name} cancelado. O link deixou de valer, e ${member.email} pode ser convidado de novo.`,
      })
    } else if (result.kind === 'not-pending') {
      setNotice({
        kind: 'info',
        title: `O convite de ${member.name} não está mais pendente`,
        text: 'A pessoa já aceitou o convite ou a conta foi desativada. A lista foi atualizada.',
      })
    } else {
      setNotice({ kind: 'error', title: `${member.name} não está mais na equipe`, error: null })
    }
  }

  const row = (member: Professional) => {
    const situation = situationOf(member, account.userId)
    const isOwner = member.user_id === account.userId
    const Icon = SITUATION_ICONS[situation]
    const names = serviceNames(member)
    const open = editing === member.id
    const canEditServices = situation !== 'deactivated' && services.isSuccess

    return (
      <li key={member.id} aria-label={member.name} className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-base font-semibold">
                {member.name}
                {isOwner ? <span className="font-normal text-muted-foreground"> (você)</span> : null}
              </h3>
              <Badge className={`h-6 gap-1 px-2 text-xs ${SITUATION_VARIANTS[situation]}`}>
                <Icon aria-hidden="true" />
                {SITUATION_LABELS[situation]}
              </Badge>
            </div>
            <p className="text-sm wrap-anywhere text-muted-foreground">{member.email}</p>
            {situation === 'deactivated' || !services.isSuccess ? null : (
              <p className="text-[0.9375rem] text-pretty">
                {names.length === 0 ? (
                  <span className="text-muted-foreground">Nenhum serviço: não recebe reservas.</span>
                ) : (
                  names.join(', ')
                )}
              </p>
            )}
            {situation === 'pending' ? (
              <p className="text-sm text-pretty text-muted-foreground">
                {invitationValidity(member.invitation_expires_at, account.timeZone)}
              </p>
            ) : null}
          </div>

          {situation === 'deactivated' ? null : (
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              {canEditServices ? (
                <Button
                  ref={(element) => {
                    servicesButtons.current.set(member.id, element)
                  }}
                  type="button"
                  variant="outline"
                  className="h-11 px-3 text-[0.9375rem] md:h-9"
                  aria-expanded={open}
                  aria-label={`Serviços de ${member.name}`}
                  onClick={() => setEditing(open ? null : member.id)}
                >
                  <ListChecksIcon aria-hidden="true" />
                  Serviços
                </Button>
              ) : null}
              {situation === 'pending' && !account.isDemo ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 px-3 text-[0.9375rem] md:h-9"
                  disabled={renewing !== null || retry.waiting}
                  aria-label={`Reenviar convite para ${member.name}`}
                  onClick={() => void resend(member)}
                >
                  {renewing === member.id ? <Spinner aria-hidden="true" /> : <MailIcon aria-hidden="true" />}
                  {retry.waiting ? retry.label : 'Reenviar convite'}
                </Button>
              ) : null}
              {situation === 'pending' && !account.isDemo ? (
                <CancelInvitationDialog professional={member} onSettled={(result) => cancelled(member, result)} />
              ) : null}
              {situation === 'active' || situation === 'owner-serving' ? (
                <DeactivateDialog
                  professional={member}
                  isOwner={isOwner}
                  onSettled={(result) => deactivated(member, isOwner, result)}
                />
              ) : null}
              {situation === 'owner-not-serving' ? <ServeButton busy={startServing.isPending} onClick={serve} /> : null}
            </div>
          )}
        </div>
        {open && services.data !== undefined ? (
          <div className="rounded-lg border bg-muted/40 p-3 sm:p-4">
            <MemberServices
              professional={member}
              services={services.data}
              onClose={() => {
                setEditing(null)
                requestAnimationFrame(() => servicesButtons.current.get(member.id)?.focus())
              }}
            />
          </div>
        ) : null}
      </li>
    )
  }

  let body: ReactNode
  if (team.isPending) {
    body = (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    )
  } else if (team.isError) {
    body = (
      <ErrorMessage error={team.error} title="Não foi possível carregar a equipe" onRetry={() => void team.refetch()} />
    )
  } else {
    body = (
      <>
        {own === null ? (
          <section
            aria-labelledby="equipe-dono"
            className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <h2 id="equipe-dono" className="text-lg font-semibold">
                Você não atende clientes
              </h2>
              <p className="text-[0.9375rem] text-pretty text-muted-foreground">
                Se você também faz atendimentos, entre na equipe para receber reservas e ter expediente.
              </p>
            </div>
            <ServeButton busy={startServing.isPending} onClick={serve} />
          </section>
        ) : null}

        <section aria-labelledby="equipe-lista" className="flex flex-col gap-3">
          <h2 id="equipe-lista" className="text-lg font-semibold">
            Na equipe <span className="font-normal text-muted-foreground tabular-nums">({current.length})</span>
          </h2>
          {services.isError ? (
            <ErrorMessage
              error={services.error}
              title="Não foi possível carregar os serviços"
              onRetry={() => void services.refetch()}
            />
          ) : null}
          {current.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Ninguém na equipe ainda</EmptyTitle>
                <EmptyDescription>Convide o primeiro profissional abaixo, ou passe a atender com “Também atendo”.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">{current.map(row)}</ul>
          )}
        </section>

        {gone.length > 0 ? (
          <Collapsible className="flex flex-col gap-3">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="h-11 self-start px-2 text-[0.9375rem] md:h-9">
                Desativados ({gone.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul aria-label="Desativados" className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
                {gone.map(row)}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <section className="rounded-xl border bg-card p-4">
          {account.isDemo ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Convidar profissional</h2>
              <Alert role="status">
                <InfoIcon aria-hidden="true" />
                <AlertTitle>Convites desligados na demonstração</AlertTitle>
                <AlertDescription>
                  O negócio de demonstração não envia convites, para que não sirva para mandar e-mails a terceiros. Em um
                  negócio real, o convite chega por e-mail com um link para a pessoa criar a senha.
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <InviteForm timeZone={account.timeZone} team={team.data} retry={retry} />
          )}
        </section>
      </>
    )
  }

  return (
    <PanelPage
      title="Equipe"
      description="Quem atende no negócio, os serviços de cada um e os convites. Só quem tem serviço e aceitou o convite recebe reservas."
    >
      {notice !== null ? (
        <div ref={noticeRef} tabIndex={-1} className="flex flex-col gap-3">
          <NoticeView notice={notice} timeZone={account.timeZone} />
        </div>
      ) : null}
      {body}
    </PanelPage>
  )
}

/**
 * D98: until when the pending link is valid, in the time zone of the business
 * (D56). Past the date the invite is still pending (D95) and can be renewed.
 */
function invitationValidity(expiresAt: string | null, timeZone: string): string {
  if (expiresAt === null) return 'Entra nas reservas quando aceitar o convite.'
  const when = formatDateTime(expiresAt, timeZone)
  return Date.parse(expiresAt) <= Date.now()
    ? `O convite venceu em ${when}. Reenvie para mandar um novo link.`
    : `Entra nas reservas quando aceitar o convite, que expira em ${when}.`
}

function ServeButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="lg"
      className="h-11 shrink-0 px-5 text-base"
      disabled={busy}
      onClick={() => onClick()}
    >
      {busy ? <Spinner aria-hidden="true" /> : <UserPlusIcon aria-hidden="true" className="size-5" />}
      Também atendo
    </Button>
  )
}

function NoticeView({ notice, timeZone }: { notice: Notice; timeZone: string }) {
  if (notice.kind === 'success') {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
          <CheckIcon aria-hidden="true" className="size-4" strokeWidth={2.5} />
        </span>
        <p className="self-center font-medium text-pretty">{notice.text}</p>
      </div>
    )
  }
  if (notice.kind === 'info') {
    return (
      <Alert role="status">
        <InfoIcon aria-hidden="true" />
        <AlertTitle>{notice.title}</AlertTitle>
        <AlertDescription>{notice.text}</AlertDescription>
      </Alert>
    )
  }
  if (notice.kind === 'error') {
    if (notice.error === null) {
      return (
        <Alert role="status">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>A lista foi atualizada.</AlertDescription>
        </Alert>
      )
    }
    return <ErrorMessage error={notice.error} title={notice.title} />
  }
  const count = notice.appointments.length
  const who = notice.isOwner ? 'Você' : notice.professional.name.split(' ')[0]
  const each = count === 1 ? 'o agendamento' : 'cada um'
  return (
    <>
      <Alert variant="destructive">
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>
          {count === 1 ? `${who} tem um agendamento pela frente` : `${who} tem ${count} agendamentos pela frente`}
        </AlertTitle>
        <AlertDescription>
          <p>
            {notice.isOwner ? 'Você continua nas reservas.' : 'Ninguém foi desativado.'} Remarque {each} para outro
            profissional, ou cancele, pela agenda, e tente de novo.
          </p>
        </AlertDescription>
      </Alert>
      <AppointmentLinks
        appointments={notice.appointments}
        timeZone={timeZone}
        filterByProfessional
        label={`Agendamentos futuros de ${notice.professional.name}`}
      />
    </>
  )
}

