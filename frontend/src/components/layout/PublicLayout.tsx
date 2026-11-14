import { Link, Outlet } from 'react-router'

import { ConnectionNotice } from '@/components/feedback/ConnectionNotice'
import { Button } from '@/components/ui/button'

import { Brand } from './Brand'
import { SkipLink } from './SkipLink'

/** Public pages and account pages: mobile first, from 360 px (D55). */
export function PublicLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <SkipLink />
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Brand />
          <nav aria-label="Principal">
            <Button asChild variant="ghost" className="h-11 px-4 text-[0.9375rem]">
              <Link to="/entrar">Entrar</Link>
            </Button>
          </nav>
        </div>
      </header>
      <ConnectionNotice />
      <main id="conteudo" className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 text-sm text-muted-foreground sm:px-6">
          Agenda Inteligente é um projeto de portfólio full stack, feito com FastAPI, PostgreSQL,
          React e TypeScript.
        </div>
      </footer>
    </div>
  )
}
