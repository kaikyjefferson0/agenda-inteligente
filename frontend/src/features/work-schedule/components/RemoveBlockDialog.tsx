import { Trash2Icon } from 'lucide-react'
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
import type { TimeBlock } from '@/features/scheduling'

import type { BlockWhen } from '../block-period'
import { useDeleteTimeBlock } from '../queries'

export type RemoveResult = 'removed' | 'gone'

interface RemoveBlockDialogProps {
  block: TimeBlock
  when: BlockWhen
  onSettled: (result: RemoveResult) => void
}

/**
 * UC09, removing, confirmed as the cancellations (D67, D84): the focus starts
 * on "Manter bloqueio", the request goes once, and the dialog stays open until
 * the answer. A failure is told inside it; a `404` (removed meanwhile, in
 * another tab) closes it, and the list is read again.
 */
export function RemoveBlockDialog({ block, when, onSettled }: RemoveBlockDialogProps) {
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const mutation = useDeleteTimeBlock(block.professional_id)
  const sending = useRef(false)
  const answered = useRef(false)

  const settle = (result: RemoveResult) => {
    answered.current = true
    setOpen(false)
    onSettled(result)
  }

  const confirm = async () => {
    if (sending.current) return
    sending.current = true
    setFailure(null)
    try {
      await mutation.mutateAsync(block.id)
      settle('removed')
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) settle('gone')
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
          className="h-11 shrink-0 px-3 text-[0.9375rem] md:h-9"
          aria-label={`Remover o bloqueio de ${when.days}, ${when.hours.toLocaleLowerCase('pt-BR')}`}
        >
          <Trash2Icon aria-hidden="true" />
          Remover
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        className="gap-5 p-5 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          // The button that opened it is gone: the list moves the focus.
          if (answered.current) event.preventDefault()
        }}
      >
        <AlertDialogHeader className="gap-2">
          <AlertDialogTitle className="text-xl font-semibold">Remover este bloqueio?</AlertDialogTitle>
          <AlertDialogDescription className="text-[0.9375rem] text-pretty">
            <span className="inline-block first-letter:uppercase">{when.days}</span>,{' '}
            <span className="tabular-nums">{when.hours.toLocaleLowerCase('pt-BR')}</span>: “{block.reason}”. Dentro do
            expediente, o horário volta a aceitar reservas.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure !== null ? <ErrorMessage error={failure} title="Não foi possível remover" /> : null}
        <AlertDialogFooter className="-mx-5 -mb-5 p-5">
          {/* The Slot joins classes without tailwind-merge: `!` beats the button's own size. */}
          <AlertDialogCancel size="lg" className="h-11! px-5! text-base!" disabled={busy}>
            Manter bloqueio
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
                Removendo…
              </>
            ) : (
              <>
                <Trash2Icon aria-hidden="true" className="size-5" />
                Remover bloqueio
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
