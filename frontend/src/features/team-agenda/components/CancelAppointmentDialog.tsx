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
import { formatDateTime } from '@/lib/datetime'

import { isFinalRefusal } from '../messages'
import { useCancelAppointment, type StaffAppointment, type StaffChange } from '../queries'

export type CancelResult = { kind: 'cancelled'; change: StaffChange } | { kind: 'refused'; error: unknown }

interface CancelAppointmentDialogProps {
  appointment: StaffAppointment
  timeZone: string
  professional: string
  onSettled: (result: CancelResult) => void
}

/**
 * UC17 without the deadline of the customer (RN20), confirmed as in the link
 * (D67, D84): the focus starts on "Manter agendamento", the request goes once,
 * and the dialog stays open until the answer. A failure is told inside it; a
 * final refusal closes it and the sheet tells why.
 */
export function CancelAppointmentDialog({
  appointment,
  timeZone,
  professional,
  onSettled,
}: CancelAppointmentDialogProps) {
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const mutation = useCancelAppointment(appointment.id)
  const sending = useRef(false)
  const answered = useRef(false)

  const settle = (result: CancelResult) => {
    answered.current = true
    setOpen(false)
    onSettled(result)
  }

  const confirm = async () => {
    if (sending.current) return
    sending.current = true
    setFailure(null)
    try {
      settle({ kind: 'cancelled', change: await mutation.mutateAsync() })
    } catch (error) {
      if (isFinalRefusal(error)) settle({ kind: 'refused', error })
      else setFailure(error)
    } finally {
      sending.current = false
    }
  }

  const busy = mutation.isPending

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return
        if (next) {
          answered.current = false
          setFailure(null)
        }
        setOpen(next)
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" size="lg" className="h-11 px-4 text-base">
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
          <AlertDialogTitle className="text-xl font-semibold">Cancelar este agendamento?</AlertDialogTitle>
          <AlertDialogDescription className="text-[0.9375rem] text-pretty">
            {appointment.service_name} de {appointment.customer_name} com {professional},{' '}
            <span className="tabular-nums">{formatDateTime(appointment.starts_at, timeZone)}</span>. O
            horário fica livre, e o cancelamento não pode ser desfeito.{' '}
            {appointment.customer_email !== null
              ? 'O cliente recebe um aviso por e-mail.'
              : 'O agendamento não tem e-mail: avise o cliente por outro meio.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure !== null ? <ErrorMessage error={failure} title="Não foi possível cancelar" /> : null}
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
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? (
              <>
                <Spinner aria-hidden="true" />
                Cancelando…
              </>
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
