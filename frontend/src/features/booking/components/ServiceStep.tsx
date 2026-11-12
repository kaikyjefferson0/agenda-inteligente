import { useState } from 'react'

import { formatDuration, formatPrice } from '@/lib/format'

import {
  ChoiceList,
  ContinueButton,
  isBookable,
  type PublicBusiness,
  type PublicService,
} from '@/features/scheduling'

interface ServiceStepProps {
  business: PublicBusiness
  selected: PublicService | null
  onContinue: (serviceId: string) => void
}

export function ServiceStep({ business, selected, onContinue }: ServiceStepProps) {
  const [value, setValue] = useState<string | undefined>(selected?.id)

  if (business.services.length === 0) {
    return (
      <p className="text-muted-foreground">
        {business.name} ainda não tem serviços para agendar pela internet. Fale com o negócio.
      </p>
    )
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (value !== undefined) onContinue(value)
      }}
    >
      <ChoiceList
        label="Serviços"
        name="servico"
        value={value}
        onValueChange={setValue}
        choices={business.services.map((service) => {
          const bookable = isBookable(business, service)
          const duration = formatDuration(service.duration_minutes)
          return {
            value: service.id,
            title: service.name,
            description: bookable ? duration : `${duration} · sem profissional disponível agora`,
            aside: formatPrice(service.price_cents),
            disabled: !bookable,
          }
        })}
      />
      <ContinueButton disabled={value === undefined} />
    </form>
  )
}
