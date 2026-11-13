import { MailXIcon } from 'lucide-react'
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
import type { Professional } from '@/features/scheduling'

import { useCancelInvitation } from '../queries'

export type CancelInvitationResult = { kind: 'done' } | { kind: 'not-pending' } | { kind: 'gone' }

interface CancelInvitationDialogProps {
  professional: Professional
  onSettled: (result: CancelInvitationResult) => void
}

/**
 * D98: cancelling a pending invite, confirmed as the cancellations (D67). The
 * focus starts on "Manter convite", the request goes once, and the dialog
 * stays open until the answer. `409 INVITATION_NOT_PENDING` (accepted in the
 * meantime) and `404` close it, and the page explains after reading the team
 * again; a failure of the network stays inside it, to try again.
 */
export function CancelInvitationDialog({ professional, onSettled }: CancelInvitationDialogProps) {
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const mutation = useCancelInvitation()
  const sending = useRef(false)
  const answered = useRef(false)
  const firstName = professional.name.split(' ')[0]

  const settle = (result: CancelInvitationResult) => {
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
      if (error instanceof ApiError && error.hasCode('INVITATION_NOT_PENDING')) settle({ kind: 'not-pending' })
      else if (error instanceof ApiError && error.status === 404) settle({ kind: 'gone' })
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
        <Button
          type="button"
          variant="destructive"
          className="h-11 px-3 text-[0.9375rem] md:h-9"
          aria-label={`Cancelar convite de ${professional.name}`}
        >
          <MailXIcon aria-hidden="true" />
          Cancelar convite
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        className="gap-5 p-5 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          // The row is gone or changed: the page moves the focus to its notice.
          if (answered.current) event.preventDefault()
        }}
      >
        <AlertDialogHeader className="gap-2">
          <AlertDialogTitle className="text-xl font-semibold">Cancelar o convite de {professional.name}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2 text-[0.9375rem] text-pretty">
              <p>
                O link enviado para <span className="wrap-anywhere">{professional.email}</span> deixa de valer na hora,
                e {firstName} sai da equipe. Os serviços e o expediente já configurados para {firstName} são apagados.
              </p>
              <p>O e-mail fica livre: você pode convidar o mesmo endereço de novo quando quiser.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure !== null ? <ErrorMessage error={failure} title="Não foi possível cancelar o convite" /> : null}
        <AlertDialogFooter className="-mx-5 -mb-5 p-5">
          {/* The Slot joins classes without tailwind-merge: `!` beats the button's own size. */}
          <AlertDialogCancel size="lg" className="h-11! px-5! text-base!" disabled={busy}>
            Manter convite
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
                <MailXIcon aria-hidden="true" className="size-5" />
                Cancelar convite
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
