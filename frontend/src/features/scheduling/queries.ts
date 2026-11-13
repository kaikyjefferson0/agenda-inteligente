import { queryOptions } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'

/**
 * Public reads shared by the booking page (UC10, UC11) and the customer link
 * (UC14): the business with its services and professionals, and the free slots.
 */

export type PublicBusiness = components['schemas']['PublicBusinessResponse']
export type PublicService = components['schemas']['PublicServiceData']
export type PublicProfessional = components['schemas']['PublicProfessionalData']
export type Availability = components['schemas']['AvailabilityResponse']

export interface AvailabilityParams {
  serviceId: string
  date: string
  /** `null` gathers the slots of every bookable professional (RN10). */
  professionalId: string | null
}

/** The slug does not tell case apart (docs/07-api.md), so neither does the cache. */
const normalize = (slug: string) => slug.toLowerCase()

export const schedulingKeys = {
  /** Every public page of a business: the configuration of the Owner invalidates them all (D93). */
  all: ['public', 'business'] as const,
  business: (slug: string) => ['public', 'business', normalize(slug)] as const,
  availabilityOf: (slug: string) =>
    ['public', 'business', normalize(slug), 'availability'] as const,
  availability: (slug: string, params: AvailabilityParams) =>
    [...schedulingKeys.availabilityOf(slug), params] as const,
}

export function businessQuery(slug: string) {
  return queryOptions({
    queryKey: schedulingKeys.business(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/public/businesses/{slug}', { params: { path: { slug } }, signal })),
  })
}

export function availabilityQuery(slug: string, params: AvailabilityParams) {
  return queryOptions({
    queryKey: schedulingKeys.availability(slug, params),
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

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}
