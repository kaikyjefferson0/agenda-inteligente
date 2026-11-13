import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'

/** `404` on `/public/businesses/{slug}`: the address points to no business. */
export function BusinessNotFound() {
  return (
    <Empty className="mx-auto max-w-md px-4 py-16">
      <title>Negócio não encontrado | Agenda Inteligente</title>
      <EmptyHeader>
        <EmptyTitle className="text-[2rem] leading-[1.1] font-semibold text-balance sm:text-[2.375rem]">
          <h1>Não encontramos este negócio</h1>
        </EmptyTitle>
        <EmptyDescription>
          Confira o endereço com quem o enviou: ele pode ter sido digitado errado ou o negócio mudou
          de endereço.
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
  )
}
