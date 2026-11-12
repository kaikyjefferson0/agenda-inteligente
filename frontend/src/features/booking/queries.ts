import { queryOptions, useMutation } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'

export type PublicBusiness = components['schemas']['PublicBusinessResponse']
export type PublicService = components['schemas']['PublicServiceData']
export type PublicProfessional = components['schemas']['PublicProfessionalData']
export type Availability = components['schemas']['AvailabilityResponse']
export type CreateBookingBody = components['schemas']['CreateBookingRequest']
export type Booking = components['schemas']['BookingResponse']

export interface AvailabilityParams {
  serviceId: string
  date: string
  /** `null` gathers the slots of every bookable professional (RN10). */
  professionalId: string | null
}

/** The slug does not tell case apart (docs/07-api.md), so neither does the cache. */
const normalize = (slug: string) => slug.toLowerCase()

export const bookingKeys = {
  business: (slug: string) => ['public', 'business', normalize(slug)] as const,
  availabilityOf: (slug: string) =>
    ['public', 'business', normalize(slug), 'availability'] as const,
  availability: (slug: string, params: AvailabilityParams) =>
    [...bookingKeys.availabilityOf(slug), params] as const,
}

export function businessQuery(slug: string) {
  return queryOptions({
    queryKey: bookingKeys.business(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/public/businesses/{slug}', { params: { path: { slug } }, signal })),
  })
}

export function availabilityQuery(slug: string, params: AvailabilityParams) {
  return queryOptions({
    queryKey: bookingKeys.availability(slug, params),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/public/businesses/{slug}/availability', {
          params: {
            path: { slug },
            query: {
              service_id: params.serviceId,
              date: params.date,
              ...(params.professionalId === null ? {} : { professional_id: params.professionalId }),
            },
          },
          signal,
        }),
      ),
  })
}

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

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}
