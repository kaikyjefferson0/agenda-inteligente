import { UserMinusIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { ApiError } from '@/api/errors'
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
import { conflictsOf, type Professional, type ScheduledAppointment } from '@/features/scheduling'

import { useDeactivate } from '../queries'

export type DeactivateResult =
  | { kind: 'done' }
  | { kind: 'gone' }
  | { kind: 'conflicts'; appointments: ScheduledAppointment[] }

interface DeactivateDialogProps {
  professional: Professional
  /** The record of the Owner only leaves the bookings, and comes back by "Também atendo" (RN23). */
  isOwner: boolean
  disabled?: boolean
  onSettled: (result: DeactivateResult) => void
}

/**
 * UC04, deactivating, confirmed as the cancellations (D67): the focus starts
 * on the button that keeps things as they are, the request goes once, and the
 * dialog stays open until the answer. For a Professional it is definitive
 * (RN23, docs/07-api.md); for the Owner it is "Deixar de atender". The
 * `409` with future appointments and a `404` close it, and the page explains;
 * a failure of the network stays inside it.
 */
export function DeactivateDialog({ professional, isOwner, disabled = false, onSettled }: DeactivateDialogProps) {
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const mutation = useDeactivate()
  const sending = useRef(false)
  const answered = useRef(false)
  const firstName = professional.name.split(' ')[0]

  const settle = (result: DeactivateResult) => {
    answered.current = true
    setOpen(false)
    onSettled(result)
  }

  const confirm = async () => {
    if (sending.current) return
    sending.current = true
    setFailure(null)
    try {
      await mutation.mutateAsync(professional.id)
      settle({ kind: 'done' })
    } catch (error) {
      const conflicts = conflictsOf(error)
      if (conflicts !== null) settle({ kind: 'conflicts', appointments: conflicts })
      else if (error instanceof ApiError && error.status === 404) settle({ kind: 'gone' })
      else setFailure(error)
    } finally {
      sending.current = false
    }
  }

  const busy = mutation.isPending
  const action = isOwner ? 'Deixar de atender' : 'Desativar'

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
        <Button
          type="button"
          variant="destructive"
          className="h-11 px-3 text-[0.9375rem] md:h-9"
          disabled={disabled}
          aria-label={isOwner ? 'Deixar de atender' : `Desativar ${professional.name}`}
        >
          <UserMinusIcon aria-hidden="true" />
          {action}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        className="gap-5 p-5 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          // The page moves the focus to its notice, as the row may have changed group.
          if (answered.current) event.preventDefault()
        }}
      >
        <AlertDialogHeader className="gap-2">
          <AlertDialogTitle className="text-xl font-semibold">
            {isOwner ? 'Deixar de atender?' : `Desativar ${professional.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            {isOwner ? (
              <div className="flex flex-col gap-2 text-[0.9375rem] text-pretty">
                <p>
                  Você sai das novas reservas e continua entrando no painel, com acesso a tudo. Seus agendamentos
                  passados continuam no histórico.
                </p>
                <p>Para voltar a atender, use “Também atendo” nesta página.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-[0.9375rem] text-pretty">
                <p>
                  <strong className="font-semibold text-foreground">É definitivo: não há como reativar.</strong>{' '}
                  {firstName} perde o acesso ao painel na hora, sai das novas reservas, e o e-mail{' '}
                  <span className="wrap-anywhere">{professional.email}</span> não pode ser convidado de novo.
                </p>
                <p>Os agendamentos passados continuam no histórico. Com agendamentos futuros, a desativação é recusada.</p>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure !== null ? <ErrorMessage error={failure} title={`Não foi possível ${action.toLowerCase()}`} /> : null}
        <AlertDialogFooter className="-mx-5 -mb-5 p-5">
          {/* The Slot joins classes without tailwind-merge: `!` beats the button's own size. */}
          <AlertDialogCancel size="lg" className="h-11! px-5! text-base!" disabled={busy}>
            {isOwner ? 'Continuar atendendo' : 'Manter na equipe'}
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
                {isOwner ? 'Saindo…' : 'Desativando…'}
              </>
            ) : (
              <>
                <UserMinusIcon aria-hidden="true" className="size-5" />
                {isOwner ? 'Deixar de atender' : 'Desativar definitivamente'}
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
