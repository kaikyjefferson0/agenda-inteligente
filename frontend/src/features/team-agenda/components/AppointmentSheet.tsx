import { CalendarClockIcon, CheckIcon, InfoIcon, MailIcon, PhoneIcon, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { StatusBadge } from '@/features/scheduling'
import { formatDateTime, formatLocalDate, formatTimeRange, toLocalDate } from '@/lib/datetime'
import { formatDuration, formatPrice } from '@/lib/format'

import { emailNote, finalRefusalMessage } from '../messages'
import { toAgendaItem, type Professional, type StaffAppointment } from '../queries'
import { sheetClassName, sheetSide } from '../sheet-layout'
import { nameOf } from '../viewer'
import { CancelAppointmentDialog, type CancelResult } from './CancelAppointmentDialog'
import { OutcomeActions, type OutcomeResult } from './OutcomeActions'
import { RescheduleForm, type RescheduleResult } from './RescheduleForm'

/** What the sheet tells after an action, in a live region that takes the focus. */
interface Notice {
  tone: 'success' | 'info'
  title: string
  text: string | null
}

interface AppointmentSheetProps {
  appointment: StaffAppointment | null
  onClose: () => void
  /** Where the focus goes once the sheet is gone: Radix only gives it back to a `SheetTrigger`. */
  onReturnFocus: () => void
  /** The appointment after a change, as the API answered it. */
  onChange: (appointment: StaffAppointment) => void
  /** After a reschedule, the agenda goes to the new day. */
  onMoved: (day: string) => void
  desktop: boolean
  professionals: Professional[]
  /** Who may take this appointment in a reschedule (D79). */
  candidatesFor: (appointment: StaffAppointment) => Professional[]
  timeZone: string
  today: string
  now: Date
}

const ORIGIN: Record<StaffAppointment['origin'], string> = {
  public: 'Página pública',
  staff: 'Equipe',
}

/**
 * The details and actions of one appointment (UC17, UC18, D84). A confirmed
 * one shows the result (from its start), the reschedule and the cancel; a
 * final status shows only the badge (RN15). After an action, the button that
 * opened it may be gone, so the notice takes the focus.
 */
export function AppointmentSheet({
  appointment,
  onClose,
  onReturnFocus,
  onChange,
  onMoved,
  desktop,
  professionals,
  candidatesFor,
  timeZone,
  today,
  now,
}: AppointmentSheetProps) {
  return (
    <Sheet open={appointment !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent
        side={sheetSide(desktop)}
        className={sheetClassName(desktop)}
        // The first button is "Concluído", a final action: a stray Enter must not press it.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onReturnFocus()
        }}
      >
        {appointment !== null ? (
          <SheetBody
            key={appointment.id}
            appointment={appointment}
            onChange={onChange}
            onMoved={onMoved}
            professionals={professionals}
            candidatesFor={candidatesFor}
            timeZone={timeZone}
            today={today}
            now={now}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

type BodyProps = Omit<AppointmentSheetProps, 'appointment' | 'onClose' | 'onReturnFocus' | 'desktop'> & {
  appointment: StaffAppointment
}

function SheetBody({
  appointment,
  onChange,
  onMoved,
  professionals,
  candidatesFor,
  timeZone,
  today,
  now,
}: BodyProps) {
  const [mode, setMode] = useState<'view' | 'reschedule'>('view')
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const rescheduleButton = useRef<HTMLButtonElement>(null)
  const returnToReschedule = useRef(false)

  useEffect(() => {
    if (notice !== null) noticeRef.current?.focus()
  }, [notice])

  useEffect(() => {
    if (mode === 'view' && returnToReschedule.current) {
      returnToReschedule.current = false
      rescheduleButton.current?.focus()
    }
  }, [mode])

  const professional = nameOf(professionals, appointment.professional_id)
  const day = formatLocalDate(toLocalDate(appointment.starts_at, timeZone))
  const hours = formatTimeRange(appointment.starts_at, appointment.ends_at, timeZone)
  const confirmed = appointment.status === 'confirmed'

  const onCancelled = (result: CancelResult) => {
    if (result.kind === 'cancelled') {
      onChange(toAgendaItem(result.change))
      setNotice({ tone: 'success', title: 'Agendamento cancelado', text: emailNote('cancelled', result.change.email_status) })
    } else {
      setNotice({ tone: 'info', title: 'Não foi possível cancelar', text: finalRefusalMessage(result.error) })
    }
  }

  const onOutcome = (result: OutcomeResult) => {
    if (result.kind === 'recorded') {
      onChange(result.appointment)
      setNotice({
        tone: 'success',
        title: result.appointment.status === 'completed' ? 'Atendimento concluído' : 'Não comparecimento registrado',
        text: null,
      })
    } else {
      setNotice({ tone: 'info', title: 'Não foi possível registrar', text: finalRefusalMessage(result.error) })
    }
  }

  const onRescheduled = (result: RescheduleResult) => {
    setMode('view')
    if (result.kind === 'rescheduled') {
      const item = toAgendaItem(result.change)
      onChange(item)
      onMoved(toLocalDate(item.starts_at, timeZone))
      setNotice({
        tone: 'success',
        title: `Remarcado para ${formatDateTime(item.starts_at, timeZone)}`,
        text: emailNote('rescheduled', result.change.email_status),
      })
    } else if (result.kind === 'changed') {
      if (result.appointment !== undefined) onChange(result.appointment)
      setNotice({ tone: 'info', title: 'O agendamento mudou', text: result.message })
    } else {
      setNotice({ tone: 'info', title: 'Não foi possível remarcar', text: finalRefusalMessage(result.error) })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <SheetHeader className="gap-1.5 p-0 pr-10">
        <SheetTitle className="font-heading text-2xl font-semibold tracking-tight">
          {appointment.service_name}
        </SheetTitle>
        <SheetDescription className="text-[0.9375rem] text-foreground tabular-nums">
          {`${day.charAt(0).toLocaleUpperCase('pt-BR')}${day.slice(1)}, ${hours}`}
        </SheetDescription>
        <div className="pt-1">
          <StatusBadge status={appointment.status} />
        </div>
      </SheetHeader>

      <div ref={noticeRef} tabIndex={-1} role="status" className="empty:hidden">
        {notice !== null ? (
          // The wrapper is the live region already: no second one inside it.
          <Alert role={undefined}>
            {notice.tone === 'success' ? <CheckIcon aria-hidden="true" /> : <InfoIcon aria-hidden="true" />}
            <AlertTitle>{notice.title}</AlertTitle>
            {notice.text !== null ? <AlertDescription>{notice.text}</AlertDescription> : null}
          </Alert>
        ) : null}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-2">
        <Detail term="Cliente">{appointment.customer_name}</Detail>
        <Detail term="Profissional">{professional}</Detail>
        {appointment.customer_phone !== null ? (
          <Detail term="Telefone">
            <ContactLink href={`tel:${appointment.customer_phone}`} icon={PhoneIcon}>
              {appointment.customer_phone}
            </ContactLink>
          </Detail>
        ) : null}
        {appointment.customer_email !== null ? (
          <Detail term="E-mail">
            <ContactLink href={`mailto:${appointment.customer_email}`} icon={MailIcon}>
              {appointment.customer_email}
            </ContactLink>
          </Detail>
        ) : null}
        <Detail term="Duração">
          {formatDuration(appointment.duration_minutes)}
          {appointment.preparation_minutes > 0 ? (
            <span className="text-muted-foreground"> + {formatDuration(appointment.preparation_minutes)} de preparo</span>
          ) : null}
        </Detail>
        <Detail term="Valor">
          <span className="tabular-nums">{formatPrice(appointment.price_cents)}</span>
        </Detail>
        <Detail term="Origem">{ORIGIN[appointment.origin]}</Detail>
      </dl>

      <Separator />

      {!confirmed ? (
        <p className="text-[0.9375rem] text-muted-foreground">
          Situação final: este agendamento não pode mais ser alterado.
        </p>
      ) : mode === 'reschedule' ? (
        <RescheduleForm
          appointment={appointment}
          candidates={candidatesFor(appointment)}
          professionals={professionals}
          timeZone={timeZone}
          today={today}
          now={now}
          onDone={onRescheduled}
          onKeep={() => {
            returnToReschedule.current = true
            setMode('view')
          }}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <OutcomeActions
            appointment={appointment}
            timeZone={timeZone}
            today={today}
            onSettled={onOutcome}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              ref={rescheduleButton}
              type="button"
              variant="outline"
              size="lg"
              className="h-11 px-4 text-base"
              onClick={() => {
                setNotice(null)
                setMode('reschedule')
              }}
            >
              <CalendarClockIcon aria-hidden="true" className="size-5" />
              Remarcar
            </Button>
            <CancelAppointmentDialog
              appointment={appointment}
              timeZone={timeZone}
              professional={professional}
              onSettled={onCancelled}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  )
}

function ContactLink({ href, icon: Icon, children }: { href: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 max-w-full items-center gap-2 text-primary underline-offset-4 hover:underline md:min-h-0"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 break-all">{children}</span>
    </a>
  )
}
