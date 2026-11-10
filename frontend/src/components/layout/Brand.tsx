import { Link } from 'react-router'

import { cn } from '@/lib/utils'

/** Mark of the product: three time slots, the middle one chosen. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn('size-8 shrink-0', className)}
    >
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <rect x="8" y="8.5" width="12" height="3" rx="1.5" className="fill-primary-foreground/45" />
      <rect x="8" y="14.5" width="16" height="3" rx="1.5" className="fill-primary-foreground" />
      <rect x="8" y="20.5" width="9" height="3" rx="1.5" className="fill-primary-foreground/45" />
    </svg>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        'inline-flex min-h-11 items-center gap-2.5 font-heading text-[1.0625rem] font-semibold tracking-tight',
        className,
      )}
    >
      <BrandMark />
      <span>Agenda Inteligente</span>
    </Link>
  )
}
