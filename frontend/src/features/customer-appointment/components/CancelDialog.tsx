import { CalendarXIcon } from 'lucide-react'
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
import { useRetryAfter } from '@/features/scheduling'
import { formatDateTime } from '@/lib/datetime'

import { isFinalRefusal, type Outcome } from '../outcome'
import { useCancelAppointment, type CustomerAppointment } from '../queries'
import { Unbroken } from './Unbroken'

interface CancelDialogProps {
  token: string
  appointment: CustomerAppointment
  /** The answer, final or not: the dialog is closed and the page tells it. */
  onSettled: (outcome: Outcome) => void
}

/**
 * UC13, confirmed in an alert dialog (D67). Esc and "Manter agendamento"
 * close it, and Radix gives the focus back to the trigger. Once answered, the
 * trigger is gone (the appointment is cancelled or was read again), so the page
 * takes the focus instead.
 */
export function CancelDialog({ token, appointment, onSettled }: CancelDialogProps) {
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const mutation = useCancelAppointment(token)
  const retry = useRetryAfter()
  // Set synchronously on click: a double click never sends twice.
  const sending = useRef(false)
  const answered = useRef(false)

  const when = formatDateTime(appointment.starts_at, appointment.business.timezone)

  const settle = (outcome: Outcome) => {
    answered.current = true
    setOpen(false)
    onSettled(outcome)
  }

  const confirm = async () => {
    if (sending.current || retry.holding()) return
    sending.current = true
    setFailure(null)
    try {
      const change = await mutation.mutateAsync()
      settle({ kind: 'cancelled', emailStatus: change.email_status })
    } catch (error) {
      if (isFinalRefusal(error)) {
        settle({ kind: 'refused', error })
      } else {
        retry.holdFor(error)
        setFailure(error)
      }
    } finally {
      sending.current = false
    }
  }

  const busy = mutation.isPending

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // While the request is on its way, the answer decides what comes next.
        if (!next && busy) return
        if (next) {
          answered.current = false
          setFailure(null)
        }
        setOpen(next)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          size="lg"
          className="h-11 w-full px-5 text-base sm:w-auto"
        >
          <CalendarXIcon aria-hidden="true" className="size-5" />
          Cancelar agendamento
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
            Cancelar este agendamento?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[0.9375rem] text-pretty">
            {appointment.service.name} com {appointment.professional.name},{' '}
            <span className="tabular-nums">
              <Unbroken text={when} />
            </span>
            . O horário fica livre para outra pessoa, e
            o cancelamento não pode ser desfeito.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure !== null ? (
          <ErrorMessage error={failure} title="Não foi possível cancelar" />
        ) : null}
        <AlertDialogFooter className="-mx-5 -mb-5 p-5">
          {/* The Slot joins classes without tailwind-merge: `!` beats the button's own size. */}
          <AlertDialogCancel size="lg" className="h-11! px-5! text-base!" disabled={busy}>
            Manter agendamento
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="h-11 px-5 text-base"
            disabled={busy || retry.waiting}
            onClick={() => void confirm()}
          >
            {busy ? (
              <>
                <Spinner aria-hidden="true" />
                Cancelando…
              </>
            ) : retry.waiting ? (
              `Aguarde ${retry.wait} s`
            ) : (
              <>
                <CalendarXIcon aria-hidden="true" className="size-5" />
                Cancelar agendamento
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
