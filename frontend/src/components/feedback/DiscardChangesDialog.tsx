import type { ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface DiscardChangesDialogProps {
  open: boolean
  title: string
  description: ReactNode
  /** What discarding leads to, such as "Descartar e sair". */
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * The question before losing changes not saved (D85, D100): leaving the page
 * or switching the professional of the working hours. The focus starts on
 * "Continuar editando", so a distracted Enter keeps the work; Esc does too.
 */
export function DiscardChangesDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: DiscardChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent className="gap-5 p-5 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="gap-2">
          <AlertDialogTitle className="text-xl font-semibold">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[0.9375rem] text-pretty">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="-mx-5 -mb-5 p-5">
          {/* The Slot joins classes without tailwind-merge: `!` beats the button's own size. */}
          <AlertDialogCancel size="lg" className="h-11! px-5! text-base!">
            Continuar editando
          </AlertDialogCancel>
          <AlertDialogAction size="lg" variant="outline" className="h-11! px-5! text-base!" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
