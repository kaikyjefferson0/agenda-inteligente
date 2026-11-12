import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

/** The main action of a step: full width on the phone, at the right on larger screens. */
export function ContinueButton({
  disabled = false,
  children = 'Continuar',
}: {
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <Button
      type="submit"
      size="lg"
      disabled={disabled}
      className="h-11 w-full px-6 text-base sm:w-auto sm:min-w-44 sm:self-end"
    >
      {children}
    </Button>
  )
}
