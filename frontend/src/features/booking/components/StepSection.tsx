import { useEffect, useId, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface StepSectionProps {
  title: string
  /** 1-based position in the flow. */
  position: number
  total: number
  /** Moves focus to the title when the step opens after a choice. */
  focusOnMount: boolean
  children: ReactNode
  className?: string
}

/** One step of the flow, with its title and "N de M" beside it, never above it. */
export function StepSection({
  title,
  position,
  total,
  focusOnMount,
  children,
  className,
}: StepSectionProps) {
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (focusOnMount) heading.current?.focus()
    // Only when the step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-5', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id={id}
          ref={heading}
          tabIndex={-1}
          className="text-[1.5rem] leading-tight font-semibold sm:text-[1.75rem]"
        >
          {title}
        </h2>
        <p className="shrink-0 text-sm text-muted-foreground tabular-nums">
          <span className="sr-only">Passo </span>
          {position} de {total}
        </p>
      </div>
      <div
        aria-hidden="true"
        className="-mt-2 grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-1 rounded-full transition-colors duration-(--duration-base)',
              index < position ? 'bg-primary' : 'bg-border',
            )}
          />
        ))}
      </div>
      {children}
    </section>
  )
}
