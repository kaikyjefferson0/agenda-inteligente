import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface AuthPageProps {
  title: string
  description: ReactNode
  /** Pages opened from a link with a token never send it in `Referer` (D54). */
  hasToken?: boolean
  children: ReactNode
  /** Below the main surface, such as the demo access of the login. */
  aside?: ReactNode
}

/**
 * Frame of the account pages: one narrow column, the title in Bricolage and
 * the form on a card from 640 px; on the phone, the form sits on the page.
 */
export function AuthPage({ title, description, hasToken = false, children, aside }: AuthPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-[27rem] flex-1 flex-col gap-8 px-4 pt-10 pb-16 sm:pt-16">
      <title>{`${title} | Agenda Inteligente`}</title>
      {hasToken ? <meta name="referrer" content="no-referrer" /> : null}
      <header className="flex flex-col gap-2">
        <h1 className="text-[2rem] leading-[1.1] font-semibold sm:text-[2.375rem]">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </header>
      <div
        className={cn(
          'flex flex-col gap-6',
          'sm:rounded-xl sm:border sm:bg-card sm:p-7 sm:text-card-foreground sm:shadow-sm',
        )}
      >
        {children}
      </div>
      {aside}
    </div>
  )
}
