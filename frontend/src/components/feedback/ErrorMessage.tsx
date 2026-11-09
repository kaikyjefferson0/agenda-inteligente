import { CircleAlertIcon } from 'lucide-react'

import { errorMessage } from '@/api/messages'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorMessageProps {
  /** Anything thrown by the API client: `ApiError`, `NetworkError` or another error. */
  error: unknown
  title?: string
  /** Shows a "Tentar de novo" button, e.g. with `refetch` of a query. */
  onRetry?: () => void
  className?: string
}

/** Reusable error message, in Portuguese, from the `code` of the API (D53). */
export function ErrorMessage({
  error,
  title = 'Não foi possível continuar',
  onRetry,
  className,
}: ErrorMessageProps) {
  return (
    <Alert variant="destructive" className={cn('gap-y-1', className)}>
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{errorMessage(error)}</p>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            Tentar de novo
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
