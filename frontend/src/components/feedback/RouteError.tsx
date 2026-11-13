import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

import { Button } from '@/components/ui/button'
import { NotFoundContent } from '@/pages/NotFoundPage'

import { ErrorMessage } from './ErrorMessage'
import { OfflineNotice } from './OfflineNotice'

/**
 * `errorElement` of each group of routes (D54). It replaces only the group, so
 * an error in the panel does not take the public pages down. A failed lazy
 * import, common right after a deploy, is solved by reloading the page.
 */
export function RouteError() {
  const error = useRouteError()

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundContent />
  }

  return (
    <>
      <OfflineNotice />
      <main
        id="conteudo"
        className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-4 px-4 py-10"
      >
        <title>Erro | Agenda Inteligente</title>
      <ErrorMessage
        error={error}
        title="Esta página não pôde ser exibida"
        onRetry={() => window.location.reload()}
      />
        <Button asChild variant="link" className="self-start px-0">
          <Link to="/">Voltar ao início</Link>
        </Button>
      </main>
    </>
  )
}
