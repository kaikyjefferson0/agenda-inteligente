import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { PageLoader } from '@/components/feedback/PageLoader'
import { AppointmentView, appointmentQuery, LinkNotFound } from '@/features/customer-appointment'
import { isNotFound } from '@/features/scheduling'

/** `/agendamento/:token`: the customer link (UC12 to UC14). */
export function CustomerAppointmentPage() {
  const { token = '' } = useParams()
  const appointment = useQuery(appointmentQuery(token))

  return (
    <>
      {/* The token is in the address: it never leaves in `Referer` (D54). */}
      <meta name="referrer" content="no-referrer" />
      {appointment.isPending ? (
        <PageLoader />
      ) : appointment.isError ? (
        isNotFound(appointment.error) ? (
          <LinkNotFound />
        ) : (
          <div className="mx-auto w-full max-w-xl px-4 py-12">
            <title>Seu agendamento | Agenda Inteligente</title>
            <h1 className="sr-only">Seu agendamento</h1>
            <ErrorMessage
              error={appointment.error}
              title="Não foi possível abrir o agendamento"
              onRetry={() => void appointment.refetch()}
            />
          </div>
        )
      ) : (
        <AppointmentView token={token} appointment={appointment.data} />
      )}
    </>
  )
}
