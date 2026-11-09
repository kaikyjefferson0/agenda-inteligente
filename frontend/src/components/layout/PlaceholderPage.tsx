import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface PlaceholderPageProps {
  title: string
  /** One sentence with what the page will do. */
  description: string
  /** Pages opened from a link with a token never send it in `Referer`. */
  hasToken?: boolean
  children?: ReactNode
  className?: string
}

/** Provisional page of this stage (D54): title and what is coming. */
export function PlaceholderPage({
  title,
  description,
  hasToken = false,
  children,
  className,
}: PlaceholderPageProps) {
  return (
    <section
      className={cn('mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-10', className)}
    >
      <title>{`${title} | Agenda Inteligente`}</title>
      {hasToken ? <meta name="referrer" content="no-referrer" /> : null}
      <Badge variant="secondary" className="self-start">
        Em construção
      </Badge>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="max-w-prose text-muted-foreground">{description}</p>
      {children}
    </section>
  )
}
