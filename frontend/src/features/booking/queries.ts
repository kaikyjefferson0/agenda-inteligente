import { useMutation } from '@tanstack/react-query'

import { api } from '@/api/client'
import type { components } from '@/api/schema'

export type CreateBookingBody = components['schemas']['CreateBookingRequest']
export type Booking = components['schemas']['BookingResponse']

export interface CreateBookingInput {
  body: CreateBookingBody
  idempotencyKey: string
}

/** UC11. Never retried automatically (D53): the key makes a manual retry safe (D64). */
export function useCreateBooking(slug: string) {
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: CreateBookingInput): Promise<Booking> => {
      const { data } = await api.POST('/api/v1/public/businesses/{slug}/appointments', {
        params: { path: { slug }, header: { 'Idempotency-Key': idempotencyKey } },
        body,
      })
      // `201` and the idempotent `200` share the same body (docs/07-api.md); the
      // OpenAPI only types the first one.
      return data as Booking
    },
  })
}
