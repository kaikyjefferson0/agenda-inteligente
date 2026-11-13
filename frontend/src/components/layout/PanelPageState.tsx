import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface FrameProps {
  title: string
  /** The agenda spans the whole width; the configuration pages use the column of `PanelPage`. */
  wide?: boolean
}

const frame = (wide: boolean) =>
  cn(
    'mx-auto flex w-full flex-1 flex-col gap-6 px-4 pt-5 pb-8 lg:px-6 lg:pt-6',
    wide ? 'max-w-[1600px]' : 'max-w-3xl',
  )

/**
 * While a page of the panel reads who is in (`GET /auth/me`): the frame of
 * the page, with its title already written and the rest as skeletons, so it
 * flows into the skeleton of the feature without a jump (no spinner first).
 */
export function PanelPageLoading({ title, wide = false }: FrameProps) {
  return (
    <section aria-busy="true" aria-labelledby="painel-carregando-titulo" className={frame(wide)}>
      <title>{`${title} | Agenda Inteligente`}</title>
      <header className="flex flex-col gap-1">
        <h1 id="painel-carregando-titulo" className="text-2xl font-semibold tracking-tight lg:text-3xl">
          {title}
        </h1>
        <Skeleton className="h-5 w-full max-w-md" />
      </header>
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </section>
  )
}

/** The same frame when reading who is in failed, with a new attempt. */
export function PanelPageError({
  title,
  wide = false,
  error,
  onRetry,
}: FrameProps & { error: unknown; onRetry: () => void }) {
  return (
    <section aria-labelledby="painel-erro-titulo" className={frame(wide)}>
      <title>{`${title} | Agenda Inteligente`}</title>
      <h1 id="painel-erro-titulo" className="text-2xl font-semibold tracking-tight lg:text-3xl">
        {title}
      </h1>
      <ErrorMessage
        error={error}
        title={`Não foi possível abrir ${title === 'Agenda' ? 'a agenda' : title.toLocaleLowerCase('pt-BR')}`}
        onRetry={onRetry}
      />
    </section>
  )
}
