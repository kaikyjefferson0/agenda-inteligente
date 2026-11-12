import { useEffect, useRef, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface ResultPanelProps {
  icon: LucideIcon
  title: string
  children: ReactNode
  /** Success in eucalyptus; a dead link in the neutral tone (not an error of the user). */
  tone?: 'success' | 'neutral'
  actions?: ReactNode
}

/**
 * What replaces a form after it is done (or can no longer be used). The
 * heading takes the focus, since the button that was pressed is gone.
 */
export function ResultPanel({ icon: Icon, title, children, tone = 'success', actions }: ResultPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [])

  return (
    <div role="status" className="flex flex-col gap-4">
      <span
        className={cn(
          'flex size-11 items-center justify-center rounded-full',
          tone === 'success'
            ? 'bg-success-soft text-success-soft-foreground'
            : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <h2 ref={headingRef} tabIndex={-1} className="text-[1.375rem] leading-tight font-semibold">
        {title}
      </h2>
      <div className="flex flex-col gap-2 text-muted-foreground">{children}</div>
      {actions !== undefined ? <div className="flex flex-col gap-3 pt-2">{actions}</div> : null}
    </div>
  )
}
