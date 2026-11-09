import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/** Shown while a group of routes loads (D54) and, later, while a page loads its data. */
export function PageLoader({ className }: { className?: string }) {
  return (
    <div className={cn('flex min-h-[50svh] flex-1 items-center justify-center', className)}>
      <Spinner className="size-6 text-primary" />
    </div>
  )
}
