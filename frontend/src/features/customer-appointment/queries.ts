import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { schedulingKeys } from '@/features/scheduling'

export type CustomerAppointment = components['schemas']['CustomerAppointmentResponse']
export type CustomerChange = components['schemas']['CustomerChangeResponse']
export type RescheduleBody = components['schemas']['RescheduleRequest']
export type AppointmentStatus = components['schemas']['AppointmentStatus']

/**
 * The token is only a key of the cache in memory: it never goes into the
 * URL of another request nor into storage.
 */
export const appointmentKeys = {
  appointment: (token: string) => ['public', 'appointment', token] as const,
}

/** UC12. `404` is final (D53): an invalid link never becomes valid on retry. */
export function appointmentQuery(token: string) {
  return queryOptions({
    queryKey: appointmentKeys.appointment(token),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/public/appointments/{token}', { params: { path: { token } }, signal }),
      ),
  })
}

/** The answer of a change is the new state of the link, plus `email_status`. */
function withoutEmailStatus(change: CustomerChange): CustomerAppointment {
  const appointment: CustomerAppointment & Partial<Pick<CustomerChange, 'email_status'>> = {
    ...change,
  }
  delete appointment.email_status
  return appointment
}

/**
 * Cancel (UC13) and reschedule (UC14). Never retried automatically (D53). On
 * success the link shows the answer at once, and the slots of the business are
 * read again, since one was freed (and, on reschedule, another taken).
 */
function useChange<Variables>(
  token: string,
  send: (variables: Variables) => Promise<CustomerChange>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: send,
    onSuccess: (change) => {
      queryClient.setQueryData(appointmentKeys.appointment(token), withoutEmailStatus(change))
      void queryClient.invalidateQueries({
        queryKey: schedulingKeys.availabilityOf(change.business.slug),
      })
    },
  })
}

export function useCancelAppointment(token: string) {
  return useChange<void>(token, () =>
    unwrap(api.POST('/api/v1/public/appointments/{token}/cancel', { params: { path: { token } } })),
  )
}

export function useRescheduleAppointment(token: string) {
  return useChange<RescheduleBody>(token, (body) =>
    unwrap(
      api.POST('/api/v1/public/appointments/{token}/reschedule', {
        params: { path: { token } },
        body,
      }),
    ),
  )
}
