import { useQuery } from '@tanstack/react-query'
import { InfoIcon } from 'lucide-react'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { PanelPage } from '@/components/layout/PanelPage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { servicesQuery } from '@/features/scheduling'

import { businessSettingsQuery } from '../queries'
import { BusinessSettingsForm } from './BusinessSettingsForm'

interface BusinessSettingsProps {
  /** The page refreshes the session data (`GET /auth/me`), which belongs to `auth` (D66, D93). */
  onSaved?: () => void
}

/** UC05: the settings of the business, only for the Owner (D74, D92). */
export function BusinessSettings({ onSaved }: BusinessSettingsProps) {
  const settings = useQuery(businessSettingsQuery)
  // The list of a new time zone names the service from the catalog: read it ahead.
  useQuery(servicesQuery)

  let body
  if (settings.isPending) {
    body = (
      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    )
  } else if (settings.isError) {
    body = (
      <ErrorMessage
        error={settings.error}
        title="Não foi possível carregar as configurações"
        onRetry={() => void settings.refetch()}
      />
    )
  } else {
    body = (
      <>
        {settings.data.is_demo ? (
          <Alert>
            <InfoIcon aria-hidden="true" />
            <AlertTitle>Negócio de demonstração</AlertTitle>
            <AlertDescription>
              O nome e o endereço ficam travados. O fuso e as regras de reserva podem ser alterados, e tudo volta ao
              original na restauração de cada noite.
            </AlertDescription>
          </Alert>
        ) : null}
        <BusinessSettingsForm saved={settings.data} onSaved={onSaved} />
      </>
    )
  }

  return (
    <PanelPage
      title="Negócio"
      description="Nome, endereço da página pública, fuso e as regras das reservas. Os agendamentos já feitos mantêm o que valia quando foram marcados, exceto o prazo de alteração."
    >
      {body}
    </PanelPage>
  )
}
