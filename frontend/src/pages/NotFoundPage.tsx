import { Link } from 'react-router'

import { Brand } from '@/components/layout/Brand'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
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
          <EmptyTitle className="text-2xl font-semibold">
            <h1>Esta página não está na agenda</h1>
          </EmptyTitle>
          <EmptyDescription>
            O endereço pode ter sido digitado errado ou mudado de lugar. Volte ao início ou veja
            como o cliente marca na demo.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          <Button asChild size="lg" className="h-11 px-4">
            <Link to="/">Voltar ao início</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-11 px-4">
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
