import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'

import { ApiError } from '@/api/errors'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  ANY_PROFESSIONAL,
  availabilityQuery,
  businessQuery,
  ChoiceList,
  DateTimePicker,
  schedulingKeys,
  type PublicBusiness,
} from '@/features/scheduling'
import { useRetryAfter } from '@/hooks/use-retry-after'
import { formatLocalDate, formatTime, toLocalDate } from '@/lib/datetime'
import { cn } from '@/lib/utils'

import { isFinalRefusal, type Outcome } from '../outcome'
import { useRescheduleAppointment, type CustomerAppointment } from '../queries'
import { rescheduleOptions } from '../reschedule'

interface RescheduleFormProps {
  token: string
  appointment: CustomerAppointment
  onSettled: (outcome: Outcome) => void
  onClose: () => void
}

/** UC14: the business is read on demand, for its professionals and calendar. */
export function RescheduleForm(props: RescheduleFormProps) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const business = useQuery(businessQuery(props.appointment.business.slug))

  useEffect(() => heading.current?.focus(), [])

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-5">
      <h2
        id={headingId}
        ref={heading}
        tabIndex={-1}
        className="text-[1.5rem] leading-tight font-semibold sm:text-[1.75rem]"
      >
        Escolha o novo horário
      </h2>
      {business.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Carregando horários…</span>
          <Skeleton className="h-19 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : business.isError ? (
        <>
          <ErrorMessage
            error={business.error}
            title="Não foi possível carregar os horários"
            onRetry={() => void business.refetch()}
          />
          <BackButton onClick={props.onClose} />
        </>
      ) : (
        <RescheduleChoices {...props} business={business.data} />
      )}
    </section>
  )
}

function RescheduleChoices({
  token,
  appointment,
  business,
  onSettled,
  onClose,
}: RescheduleFormProps & { business: PublicBusiness }) {
  const timeZone = business.timezone
  const queryClient = useQueryClient()
  const [today] = useState(() => toLocalDate(new Date(), timeZone))
  const options = useMemo(
    () => rescheduleOptions(business, appointment, today),
    [business, appointment, today],
  )
  const [professional, setProfessional] = useState<string>(
    options.initialProfessionalId ?? ANY_PROFESSIONAL,
  )
  const [day, setDay] = useState(options.initialDay)
  const [picked, setPicked] = useState<string | null>(null)
  /** The slot refused with `409` in the meantime, until another is chosen. */
  const [taken, setTaken] = useState<string | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const mutation = useRescheduleAppointment(token)
  const retry = useRetryAfter()
  const sending = useRef(false)

  const professionalId = professional === ANY_PROFESSIONAL ? null : professional
  const availability = useQuery({
    ...availabilityQuery(business.slug, {
      serviceId: appointment.service.id,
      date: day,
      professionalId,
    }),
    enabled: options.service !== null,
  })
  const slots = availability.data?.slots
  const offered = picked !== null && slots?.some((slot) => slot.starts_at === picked) === true

  if (options.service === null) {
    return (
      <>
        <Alert>
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>Este serviço não está mais disponível</AlertTitle>
          <AlertDescription>
            Para outro horário, fale com {business.name}. O agendamento atual continua valendo.
          </AlertDescription>
        </Alert>
        <BackButton onClick={onClose} />
      </>
    )
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!offered || picked === null || sending.current || retry.holding()) return
    sending.current = true
    setFailure(null)
    try {
      const change = await mutation.mutateAsync({ starts_at: picked, professional_id: professionalId })
      onSettled({ kind: 'rescheduled', emailStatus: change.email_status })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SLOT_UNAVAILABLE') {
        // Taken in the meantime: the list is read again, without it (UC14).
        setTaken(picked)
        setPicked(null)
        await queryClient.invalidateQueries({ queryKey: schedulingKeys.availabilityOf(business.slug) })
      } else if (isFinalRefusal(error)) {
        onSettled({ kind: 'refused', error })
      } else {
        retry.holdFor(error)
        setFailure(error)
      }
    } finally {
      sending.current = false
    }
  }

  const busy = mutation.isPending
  const current = appointment.professional.id

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex min-w-0 flex-col gap-7">
      {options.professionals.length > 1 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">Profissional</h3>
          <ChoiceList
            label="Profissional"
            name="profissional"
            value={professional}
            onValueChange={(value) => {
              setProfessional(value)
              setPicked(null)
              setTaken(null)
            }}
            choices={[
              {
                value: ANY_PROFESSIONAL,
                title: 'Qualquer profissional',
                description: 'Mostra mais horários. Quem estiver livre atende você.',
              },
              ...options.professionals.map((item) => ({
                value: item.id,
                title: item.name,
                description: item.id === current ? 'Atende o agendamento atual' : undefined,
              })),
            ]}
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="text-lg font-semibold">Dia e horário</h3>
        <DateTimePicker
          timeZone={timeZone}
          days={options.days}
          today={today}
          day={day}
          onDayChange={(next) => {
            setTaken(null)
            setDay(next)
          }}
          slots={slots}
          loading={availability.isPending}
          error={availability.error}
          onRetry={() => void availability.refetch()}
          value={offered ? picked : null}
          onValueChange={(startsAt) => {
            setTaken(null)
            setPicked(startsAt)
          }}
          maxAdvanceDays={business.max_advance_days}
          notice={
            taken !== null ? (
              <Alert variant="destructive">
                <CircleAlertIcon aria-hidden="true" />
                <AlertTitle>Esse horário acabou de ser reservado</AlertTitle>
                <AlertDescription className="text-destructive">
                  Alguém marcou {formatLocalDate(toLocalDate(taken, timeZone)).split(',')[0]} às{' '}
                  {formatTime(taken, timeZone)} antes da remarcação. Seu agendamento continua no
                  horário atual. A lista já está atualizada: escolha outro horário.
                </AlertDescription>
              </Alert>
            ) : null
          }
        />
      </div>

      {failure !== null ? <ErrorMessage error={failure} title="Não foi possível remarcar" /> : null}

      {/* As in the booking, the action stays in reach on the phone. Only the
          main one is pinned there, and "keep" follows it, so the bar stays
          small. On the phone this wrapper has no box (`contents`), so the bar
          sticks along the whole form; from `sm` up, both share one row. */}
      <div className="contents sm:flex sm:flex-row-reverse sm:justify-start sm:gap-2">
        <div className="sticky bottom-0 z-10 -mx-4 flex border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <Button
            type="submit"
            size="lg"
            disabled={!offered || busy || retry.waiting}
            className="h-11 w-full px-6 text-base sm:w-auto sm:min-w-52"
          >
            {busy ? (
              <>
                <Spinner aria-hidden="true" />
                Remarcando…
              </>
            ) : retry.waiting ? (
              retry.label
            ) : offered && picked !== null ? (
              `Remarcar para ${formatTime(picked, timeZone)}`
            ) : (
              'Remarcar'
            )}
          </Button>
        </div>
        <BackButton onClick={onClose} disabled={busy} className="-mt-5 sm:mt-0" />
      </div>
    </form>
  )
}

interface BackButtonProps {
  onClick: () => void
  disabled?: boolean
  className?: string
}

function BackButton({ onClick, disabled = false, className }: BackButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      disabled={disabled}
      className={cn('h-11 w-full px-5 text-base sm:w-auto sm:self-start', className)}
      onClick={onClick}
    >
      Manter o horário atual
    </Button>
  )
}
