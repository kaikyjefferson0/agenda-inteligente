import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { PageLoader } from '@/components/feedback/PageLoader'
import { BookingFlow, BusinessNotFound } from '@/features/booking'
import { businessQuery, isNotFound } from '@/features/scheduling'

/** `/n/:slug`: the public page of a business (UC10 and UC11). */
export function BusinessPage() {
  const { slug = '' } = useParams()
  const business = useQuery(businessQuery(slug))

  if (business.isPending) return <PageLoader />
  if (business.isError) {
    if (isNotFound(business.error)) return <BusinessNotFound />
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <title>Agendamento | Agenda Inteligente</title>
        <h1 className="sr-only">Agendamento</h1>
        <ErrorMessage
          error={business.error}
          title="Não foi possível abrir a página do negócio"
          onRetry={() => void business.refetch()}
        />
      </div>
    )
  }
  return <BookingFlow key={business.data.slug} business={business.data} />
}
