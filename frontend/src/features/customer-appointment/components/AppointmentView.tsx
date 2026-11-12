import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarClockIcon,
  CheckIcon,
  ClockAlertIcon,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { errorMessage } from '@/api/messages'
import { PATHS } from '@/app/router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/features/scheduling'
import { formatDateTime } from '@/lib/datetime'

import type { Outcome } from '../outcome'
import { appointmentKeys, type CustomerAppointment } from '../queries'
import { AppointmentDetails } from './AppointmentDetails'
import { CancelDialog } from './CancelDialog'
import { RescheduleForm } from './RescheduleForm'
import { Unbroken } from './Unbroken'

interface AppointmentViewProps {
  token: string
  appointment: CustomerAppointment
}

/** UC12 to UC14: what the link shows and, within the deadline, what it allows. */
export function AppointmentView({ token, appointment }: AppointmentViewProps) {
  const queryClient = useQueryClient()
  const [rescheduling, setRescheduling] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const headingId = useId()
  const rescheduleButton = useRef<HTMLButtonElement>(null)
  const returnToReschedule = useRef(false)
  const { business } = appointment

  // Leaving the reschedule without a change gives the focus back to its button.
  useEffect(() => {
    if (rescheduling || !returnToReschedule.current) return
    returnToReschedule.current = false
    rescheduleButton.current?.focus()
  }, [rescheduling])

  const settle = (next: Outcome) => {
    setRescheduling(false)
    setOutcome(next)
    if (next.kind === 'refused') {
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.appointment(token) })
    }
  }

  const confirmed = appointment.status === 'confirmed'
  const deadline = formatDateTime(appointment.change_deadline_at, business.timezone)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:gap-10 sm:px-6 sm:py-12">
      <title>{`Seu agendamento em ${business.name} | Agenda Inteligente`}</title>
      <h1 className="text-[2.375rem] leading-[1.05] font-semibold sm:text-[3.25rem]">
        {business.name}
      </h1>

      <div className="flex max-w-2xl min-w-0 flex-col gap-7">
        {outcome !== null ? <OutcomeNotice outcome={outcome} businessName={business.name} /> : null}

        <section aria-labelledby={headingId} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 id={headingId} className="text-[1.75rem] leading-tight font-semibold sm:text-[1.875rem]">
              {rescheduling ? 'Horário atual' : 'Seu agendamento'}
            </h2>
            <StatusBadge status={appointment.status} />
          </div>
          <AppointmentDetails appointment={appointment} />
          {/* While rescheduling, the picker below already says it. */}
          {rescheduling ? null : (
            <p className="text-sm text-muted-foreground">
              Horários no fuso do negócio ({business.timezone.replaceAll('_', ' ')}).
            </p>
          )}
        </section>

        {rescheduling ? (
          <RescheduleForm
            token={token}
            appointment={appointment}
            onSettled={settle}
            onClose={() => {
              returnToReschedule.current = true
              setRescheduling(false)
            }}
          />
        ) : confirmed && appointment.can_cancel ? (
          <section aria-label="Alterar o agendamento" className="flex flex-col gap-4">
            <p className="max-w-prose">
              Você pode {appointment.can_reschedule ? 'remarcar ou cancelar' : 'cancelar'} até{' '}
              <span className="font-medium tabular-nums">
                <Unbroken text={deadline} />
              </span>
              .
              {appointment.can_reschedule
                ? null
                : ` O serviço saiu da lista de ${business.name}, então não dá para remarcar pelo link.`}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {appointment.can_reschedule ? (
                <Button
                  ref={rescheduleButton}
                  type="button"
                  size="lg"
                  className="h-11 w-full px-5 text-base sm:w-auto"
                  onClick={() => {
                    setOutcome(null)
                    setRescheduling(true)
                  }}
                >
                  <CalendarClockIcon aria-hidden="true" className="size-5" />
                  Remarcar
                </Button>
              ) : null}
              <CancelDialog token={token} appointment={appointment} onSettled={settle} />
            </div>
          </section>
        ) : confirmed ? (
          // A standing fact of the page, not news: a note, not an alert.
          <Alert role="note">
            <ClockAlertIcon aria-hidden="true" />
            <AlertTitle>O prazo para alterar pelo link terminou</AlertTitle>
            <AlertDescription>
              <p>
                Dava para cancelar ou remarcar até{' '}
                <span className="tabular-nums">
                  <Unbroken text={deadline} />
                </span>
                .
                Para mudar agora, fale com {business.name}.
              </p>
              <BusinessLink slug={business.slug}>Ver a página de {business.name}</BusinessLink>
            </AlertDescription>
          </Alert>
        ) : (
          <FinalStatus appointment={appointment} />
        )}
      </div>
    </div>
  )
}

/** Cancelled and completed point to a new booking; a no-show, to nothing (D69). */
function FinalStatus({ appointment }: { appointment: CustomerAppointment }) {
  const { business } = appointment
  const text: Record<Exclude<CustomerAppointment['status'], 'confirmed'>, string> = {
    cancelled: 'Este agendamento foi cancelado, e o horário ficou livre.',
    completed: 'Este atendimento foi concluído.',
    no_show: 'Este horário foi registrado como não comparecimento.',
  }
  const status = appointment.status as keyof typeof text
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-muted-foreground">{text[status]}</p>
      {status === 'no_show' ? null : (
        <BusinessLink slug={business.slug}>Fazer novo agendamento em {business.name}</BusinessLink>
      )}
    </div>
  )
}

function BusinessLink({ slug, children }: { slug: string; children: ReactNode }) {
  return (
    <Link
      to={PATHS.business(slug)}
      className="inline-flex min-h-11 items-center self-start text-[0.9375rem] font-medium text-primary underline underline-offset-4"
    >
      {children}
    </Link>
  )
}

const NOTICES: Record<'cancelled' | 'rescheduled', { title: string; icon: LucideIcon }> = {
  cancelled: { title: 'Agendamento cancelado', icon: CheckIcon },
  rescheduled: { title: 'Agendamento remarcado', icon: CheckIcon },
}

/** The answer of a change. It takes the focus, since the button that asked is gone. */
function OutcomeNotice({ outcome, businessName }: { outcome: Outcome; businessName: string }) {
  const title = useRef<HTMLDivElement>(null)

  useEffect(() => title.current?.focus(), [outcome])

  if (outcome.kind === 'refused') {
    return (
      <Alert variant="destructive">
        <ClockAlertIcon aria-hidden="true" />
        <AlertTitle ref={title} tabIndex={-1}>
          Não foi possível concluir
        </AlertTitle>
        <AlertDescription className="text-destructive">
          {errorMessage(outcome.error)} A página já mostra a situação atual do agendamento.
        </AlertDescription>
      </Alert>
    )
  }

  const { title: heading, icon: Icon } = NOTICES[outcome.kind]
  const change = outcome.kind === 'cancelled' ? 'O cancelamento' : 'A remarcação'
  return (
    <Alert className="border-success/40 bg-success-soft text-success-soft-foreground">
      <Icon aria-hidden="true" />
      <AlertTitle ref={title} tabIndex={-1}>
        {heading}
      </AlertTitle>
      <AlertDescription className="text-success-soft-foreground">
        {outcome.emailStatus === 'queued' ? (
          <p>
            Enviamos a confirmação para o seu <span className="whitespace-nowrap">e-mail</span>.
          </p>
        ) : (
          <p>
            {change} já vale em {businessName}, mas não conseguimos enviar o{' '}
            <span className="whitespace-nowrap">e-mail</span> de confirmação agora.
          </p>
        )}
        {outcome.kind === 'rescheduled' ? (
          <p>Este link continua valendo para o novo horário.</p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
