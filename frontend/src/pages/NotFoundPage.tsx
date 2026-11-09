import { CalendarXIcon } from 'lucide-react'
import { Link } from 'react-router'

import { Brand } from '@/components/layout/Brand'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export function NotFoundContent() {
  return (
    <main id="conteudo" className="flex min-h-svh flex-col py-6">
      <title>Página não encontrada | Agenda Inteligente</title>
      <div className="mx-auto w-full max-w-5xl px-4">
        <Brand />
      </div>
      <Empty className="mx-auto max-w-md px-4">
        <EmptyHeader>
          <EmptyMedia
            variant="icon"
            className="size-12 rounded-xl bg-accent text-accent-foreground"
          >
            <CalendarXIcon className="size-6" aria-hidden="true" />
          </EmptyMedia>
          <p className="text-sm font-semibold text-primary">Erro 404</p>
          <EmptyTitle className="text-2xl font-semibold">
            <h1>Página não encontrada</h1>
          </EmptyTitle>
          <EmptyDescription>
            O endereço pode estar incorreto ou a página pode ter mudado de lugar.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          <Button asChild size="lg">
            <Link to="/">Voltar ao início</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/n/barbearia-demo">Ver a demo</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}

export default function NotFoundPage() {
  return <NotFoundContent />
}
