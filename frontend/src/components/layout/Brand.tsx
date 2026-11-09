import { CalendarCheckIcon } from 'lucide-react'
import { Link } from 'react-router'

import { cn } from '@/lib/utils'

export function Brand({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <CalendarCheckIcon className="size-4" aria-hidden="true" />
      </span>
      <span>Agenda Inteligente</span>
    </Link>
  )
}
