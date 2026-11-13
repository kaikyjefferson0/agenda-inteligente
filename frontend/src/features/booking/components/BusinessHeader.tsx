import { InfoIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import type { PublicBusiness } from '@/features/scheduling'

/** Name of the business and, on the demo, the notice of the nightly restore (RN29, D48). */
export function BusinessHeader({ business }: { business: PublicBusiness }) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-[2.375rem] leading-[1.05] font-semibold sm:text-[3.25rem]">
          {business.name}
        </h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          Escolha o serviço e um horário livre. A confirmação sai na hora.
        </p>
      </div>
      {business.is_demo ? (
        <Alert role="status" className="max-w-2xl">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>Este é um negócio de demonstração</AlertTitle>
          <AlertDescription>
            Pode agendar à vontade: os dados voltam ao estado inicial toda noite. Use um e-mail seu:
            a confirmação vai para o endereço informado.
          </AlertDescription>
        </Alert>
      ) : null}
    </header>
  )
}
