import { CheckCheckIcon, ClockIcon, UserXIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { formatDateTime, formatTime, toLocalDate } from '@/lib/datetime'

import { isFinalRefusal } from '../messages'
import { useRecordOutcome, type StaffAppointment } from '../queries'
import { useReached } from '../use-now'

export type OutcomeResult =
  | { kind: 'recorded'; appointment: StaffAppointment }
  | { kind: 'refused'; error: unknown }

interface OutcomeActionsProps {
  appointment: StaffAppointment
  timeZone: string
  today: string
  onSettled: (result: OutcomeResult) => void
}

/**
 * UC18 (D84): the result opens at the start of the appointment (RN15), at
 * that very moment and without a reload. "Concluído" is the action of every
 * day and goes at once; "Não compareceu" asks first, since both are final.
 */
export function OutcomeActions({ appointment, timeZone, today, onSettled }: OutcomeActionsProps) {
  const started = useReached(appointment.starts_at)
  const mutation = useRecordOutcome(appointment.id)
  const [failure, setFailure] = useState<unknown>(null)
  const [confirming, setConfirming] = useState(false)
  const sending = useRef(false)
  const answered = useRef(false)

  if (!started) {
    const sameDay = toLocalDate(appointment.starts_at, timeZone) === today
    const when = sameDay
      ? `das ${formatTime(appointment.starts_at, timeZone)}`
      : `de ${formatDateTime(appointment.starts_at, timeZone)}`
    return (
      <p className="flex items-start gap-2 text-[0.9375rem] text-muted-foreground">
        <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>O resultado do atendimento pode ser registrado a partir {when}.</span>
      </p>
    )
  }

  const record = async (outcome: 'completed' | 'no_show') => {
    if (sending.current) return
    sending.current = true
    setFailure(null)
    try {
      const result = await mutation.mutateAsync(outcome)
      answered.current = true
      setConfirming(false)
      onSettled({ kind: 'recorded', appointment: result })
    } catch (error) {
      if (isFinalRefusal(error)) {
        answered.current = true
        setConfirming(false)
        onSettled({ kind: 'refused', error })
      } else {
        setFailure(error)
      }
    } finally {
      sending.current = false
    }
  }

  const busy = mutation.isPending
  const busyWith = mutation.variables

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.9375rem] font-medium">Como foi o atendimento?</p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          className="h-11 px-4 text-base"
          disabled={busy}
          onClick={() => void record('completed')}
        >
          {busy && busyWith === 'completed' ? (
            <Spinner aria-hidden="true" />
          ) : (
            <CheckCheckIcon aria-hidden="true" className="size-5" />
          )}
          Concluído
        </Button>
        <AlertDialog
          open={confirming}
          onOpenChange={(next) => {
            if (!next && busy) return
            if (next) {
              answered.current = false
              setFailure(null)
            }
            setConfirming(next)
          }}
        >
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" size="lg" className="h-11 px-4 text-base" disabled={busy}>
              <UserXIcon aria-hidden="true" className="size-5" />
              Não compareceu
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent
            className="gap-5 p-5 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg"
            onCloseAutoFocus={(event) => {
              if (answered.current) event.preventDefault()
            }}
          >
            <AlertDialogHeader className="gap-2">
              <AlertDialogTitle className="text-xl font-semibold">
                Registrar que {appointment.customer_name} não compareceu?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[0.9375rem] text-pretty">
                {appointment.service_name},{' '}
                <span className="tabular-nums">{formatDateTime(appointment.starts_at, timeZone)}</span>. O
                horário continua ocupado, e a situação não pode ser mudada depois.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {failure !== null && confirming ? (
              <ErrorMessage error={failure} title="Não foi possível registrar" />
            ) : null}
            <AlertDialogFooter className="-mx-5 -mb-5 p-5">
              <AlertDialogCancel size="lg" className="h-11! px-5! text-base!" disabled={busy}>
                Voltar
              </AlertDialogCancel>
              <Button
                type="button"
                size="lg"
                className="h-11 px-5 text-base"
                disabled={busy}
                onClick={() => void record('no_show')}
              >
                {busy ? <Spinner aria-hidden="true" /> : <UserXIcon aria-hidden="true" className="size-5" />}
                Registrar não comparecimento
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {failure !== null && !confirming ? (
        <ErrorMessage error={failure} title="Não foi possível registrar" />
      ) : null}
    </div>
  )
}
