import { LinkIcon } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

/**
 * `404` on the link (D18): the API answers the same for a token that never
 * existed, was replaced or expired, so the page cannot tell them apart either.
 */
export function LinkNotFound() {
  return (
    <Empty className="mx-auto max-w-md px-4 py-16">
      <title>Link inválido | Agenda Inteligente</title>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LinkIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-[2rem] leading-[1.1] font-semibold text-balance sm:text-[2.375rem]">
          <h1>Este link não abre mais o agendamento</h1>
        </EmptyTitle>
        <EmptyDescription>
          Ele pode estar incompleto, ter sido trocado por um link mais novo ou ter expirado 30 dias
          depois do horário. Procure o e-mail mais recente do agendamento ou fale com o negócio.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild size="lg" variant="outline" className="h-11 px-4">
          <Link to="/">Voltar ao início</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
