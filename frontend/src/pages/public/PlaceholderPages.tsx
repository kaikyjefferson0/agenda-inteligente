import { useParams } from 'react-router'

import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export function BusinessPage() {
  const { slug } = useParams()
  return (
    <PlaceholderPage
      title="Página do negócio"
      description="Aqui o cliente vai escolher o serviço, o profissional e um horário livre, e confirmar o agendamento."
    >
      <p className="text-sm text-muted-foreground">
        Endereço: <code className="rounded bg-muted px-1.5 py-0.5">/n/{slug}</code>
      </p>
    </PlaceholderPage>
  )
}

export function CustomerAppointmentPage() {
  return (
    <PlaceholderPage
      hasToken
      title="Seu agendamento"
      description="Aqui o cliente vai consultar o agendamento e, dentro do prazo do negócio, cancelar ou remarcar."
    />
  )
}
