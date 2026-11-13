import { queryOptions } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'

export type Professional = components['schemas']['ProfessionalData']
export type Service = components['schemas']['ServiceData']
export type WorkingInterval = components['schemas']['IntervalData']
export type TimeBlock = components['schemas']['TimeBlockData']

/**
 * The reads of the team, shared by the agenda (UC15 to UC18) and by the
 * working hours and blocks (UC08, UC09), all under `['team']` (D66, D78).
 * The agenda of a week is `['team', 'agenda', monday, professional | 'todos']`:
 * every change invalidates `['team', 'agenda']`. The manual booking reads the
 * working hours and the blocks under these same keys, so saving them reaches
 * the agenda.
 */
export const teamKeys = {
  /** Everything the panel reads: a new time zone changes all of it (D93). */
  all: ['team'] as const,
  /** The settings of the business (UC05), only for the Owner. */
  business: ['team', 'business'] as const,
  agendaAll: ['team', 'agenda'] as const,
  agenda: (weekStart: string, professionalId: string | null) =>
    ['team', 'agenda', weekStart, professionalId ?? 'todos'] as const,
  professionals: ['team', 'professionals'] as const,
  services: ['team', 'services'] as const,
  workingHours: (professionalId: string) => ['team', 'working-hours', professionalId] as const,
  timeBlocks: (professionalId: string) => ['team', 'time-blocks', professionalId] as const,
}

/** For a Professional, only the own record, with `service_ids`. */
export const professionalsQuery = queryOptions({
  queryKey: teamKeys.professionals,
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/professionals', { signal })),
  staleTime: 5 * 60_000,
})

export const servicesQuery = queryOptions({
  queryKey: teamKeys.services,
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/services', { signal })),
  staleTime: 5 * 60_000,
})

export function workingHoursQuery(professionalId: string) {
  return queryOptions({
    queryKey: teamKeys.workingHours(professionalId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/professionals/{professional_id}/working-hours', {
          params: { path: { professional_id: professionalId } },
          signal,
        }),
      ),
  })
}

export function timeBlocksQuery(professionalId: string) {
  return queryOptions({
    queryKey: teamKeys.timeBlocks(professionalId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/professionals/{professional_id}/time-blocks', {
          params: { path: { professional_id: professionalId } },
          signal,
        }),
      ),
  })
}

/** The professional record of the person in the panel, if they serve (D74). */
export function ownProfessional(userId: string, professionals: Professional[]): Professional | null {
  return professionals.find((professional) => professional.user_id === userId) ?? null
}
