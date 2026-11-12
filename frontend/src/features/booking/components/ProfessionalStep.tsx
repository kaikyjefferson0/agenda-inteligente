import { useState } from 'react'

import {
  ANY_PROFESSIONAL,
  ChoiceList,
  ContinueButton,
  type PublicProfessional,
} from '@/features/scheduling'

interface ProfessionalStepProps {
  professionals: PublicProfessional[]
  /** `null` is "any professional"; `undefined`, nothing chosen yet. */
  selected: string | null | undefined
  onContinue: (professionalId: string | null) => void
}

export function ProfessionalStep({ professionals, selected, onContinue }: ProfessionalStepProps) {
  const [value, setValue] = useState<string>(selected ?? ANY_PROFESSIONAL)

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        onContinue(value === ANY_PROFESSIONAL ? null : value)
      }}
    >
      <ChoiceList
        label="Profissionais"
        name="profissional"
        value={value}
        onValueChange={setValue}
        choices={[
          {
            value: ANY_PROFESSIONAL,
            title: 'Qualquer profissional',
            description: 'Mostra mais horários. Quem estiver livre atende você.',
          },
          ...professionals.map((professional) => ({
            value: professional.id,
            title: professional.name,
          })),
        ]}
      />
      <ContinueButton />
    </form>
  )
}
