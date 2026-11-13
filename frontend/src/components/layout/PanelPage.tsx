import type { ReactNode } from 'react'

interface PanelPageProps {
  /** The `h1` and the tab title. */
  title: string
  description: ReactNode
  /** Beside the title from 640 px, below it on the phone: the main action of the page. */
  action?: ReactNode
  children: ReactNode
}

/**
 * The frame of a configuration page of the panel (UC04 to UC07): the same
 * column, title and spacing as the working hours and the blocks (D85).
 */
export function PanelPage({ title, description, action, children }: PanelPageProps) {
  return (
    <section
      aria-labelledby="painel-pagina-titulo"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pt-5 pb-8 lg:px-6 lg:pt-6"
    >
      <title>{`${title} | Agenda Inteligente`}</title>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id="painel-pagina-titulo" className="text-2xl font-semibold tracking-tight lg:text-3xl">
            {title}
          </h1>
          <p className="max-w-prose text-[0.9375rem] text-pretty text-muted-foreground">{description}</p>
        </div>
        {action !== undefined ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}
