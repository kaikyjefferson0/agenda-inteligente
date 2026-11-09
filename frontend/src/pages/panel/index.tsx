// Panel group (D54): loaded on demand as one chunk, together with its layout.
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export { PanelLayout } from '@/components/layout/PanelLayout'

export function AgendaPage() {
  return (
    <PlaceholderPage
      title="Agenda"
      description="Aqui a equipe vai ver os agendamentos por dia, no fuso do negócio, e registrar o resultado de cada atendimento."
    />
  )
}

export function ServicesPage() {
  return (
    <PlaceholderPage
      title="Serviços"
      description="Aqui o Dono vai criar, editar e desativar serviços, com duração, preparo e preço."
    />
  )
}

export function TeamPage() {
  return (
    <PlaceholderPage
      title="Equipe"
      description="Aqui o Dono vai convidar e desativar profissionais e escolher os serviços de cada um."
    />
  )
}

export function WorkingHoursPage() {
  return (
    <PlaceholderPage
      title="Expediente"
      description="Aqui cada profissional vai definir os intervalos de atendimento de cada dia da semana."
    />
  )
}

export function TimeBlocksPage() {
  return (
    <PlaceholderPage
      title="Bloqueios"
      description="Aqui serão registradas folgas e outras exceções ao expediente."
    />
  )
}

export function BusinessSettingsPage() {
  return (
    <PlaceholderPage
      title="Negócio"
      description="Aqui o Dono vai alterar nome, endereço, fuso, passo da grade, antecedência e prazo de alteração."
    />
  )
}
