import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'

import { weekPeriod } from './period'

export type StaffAppointment = components['schemas']['StaffAppointmentData']
export type StaffChange = components['schemas']['StaffChangeResponse']
export type CreatedAppointment = components['schemas']['CreatedAppointmentResponse']
export type CreateAppointmentBody = components['schemas']['CreateAppointmentRequest']
export type StaffRescheduleBody = components['schemas']['StaffRescheduleRequest']
export type Professional = components['schemas']['ProfessionalData']
export type Service = components['schemas']['ServiceData']
export type WorkingInterval = components['schemas']['IntervalData']
export type TimeBlock = components['schemas']['TimeBlockData']
export type SlotRefusal = components['schemas']['SlotRefusal']
export type EmailStatus = StaffChange['email_status']

/**
 * Reads of the team agenda (UC15 to UC18), all under `['team']`. The agenda
 * of a week is `['team', 'agenda', monday, professional | 'todos']` (D78):
 * every change invalidates `['team', 'agenda']`.
 */
export const teamKeys = {
  agendaAll: ['team', 'agenda'] as const,
  agenda: (weekStart: string, professionalId: string | null) =>
    ['team', 'agenda', weekStart, professionalId ?? 'todos'] as const,
  professionals: ['team', 'professionals'] as const,
  services: ['team', 'services'] as const,
  workingHours: (professionalId: string) => ['team', 'working-hours', professionalId] as const,
  timeBlocks: (professionalId: string) => ['team', 'time-blocks', professionalId] as const,
}

/**
 * The agenda of the week that starts on `weekStart`. Without a professional,
 * the Owner gets every agenda and a Professional the own one (D25).
 */
export function agendaQuery(weekStart: string, professionalId: string | null, timeZone: string) {
  return queryOptions({
    queryKey: teamKeys.agenda(weekStart, professionalId),
    queryFn: ({ signal }) => {
      const { from, to } = weekPeriod(weekStart, timeZone)
      return unwrap(
        api.GET('/api/v1/appointments', {
          params: {
            query: { from, to, ...(professionalId === null ? {} : { professional_id: professionalId }) },
          },
          signal,
        }),
      )
    },
  })
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

/** Writes the answer of a change into every agenda already read, before they are read again. */
function putInAgendas(queryClient: QueryClient, result: StaffAppointment) {
  const appointment = toAgendaItem(result)
  queryClient.setQueriesData<StaffAppointment[]>({ queryKey: teamKeys.agendaAll }, (list) =>
    list?.map((item) => (item.id === appointment.id ? appointment : item)),
  )
}

/** The answer of a change without what only the change has (`email_status`, `access_url`). */
export function toAgendaItem(result: StaffAppointment): StaffAppointment {
  const item: StaffAppointment & Partial<Pick<CreatedAppointment, 'email_status' | 'access_url'>> = {
    ...result,
  }
  delete item.email_status
  delete item.access_url
  return item
}

/**
 * Every change is never retried (D53) and, on success or on a refusal, makes
 * the agenda be read again: a refusal may mean the agenda on the screen is
 * old (a slot taken, a status changed elsewhere).
 */
function useAgendaMutation<Variables, Result extends StaffAppointment>(
  send: (variables: Variables) => Promise<Result>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: send,
    onSuccess: (result) => putInAgendas(queryClient, result),
    onSettled: () => queryClient.invalidateQueries({ queryKey: teamKeys.agendaAll }),
  })
}

export function useCreateAppointment() {
  return useAgendaMutation((body: CreateAppointmentBody) =>
    unwrap(api.POST('/api/v1/appointments', { body })),
  )
}

export function useRescheduleAppointment(id: string) {
  return useAgendaMutation((body: StaffRescheduleBody) =>
    unwrap(
      api.POST('/api/v1/appointments/{appointment_id}/reschedule', {
        params: { path: { appointment_id: id } },
        body,
      }),
    ),
  )
}

export function useCancelAppointment(id: string) {
  return useAgendaMutation(() =>
    unwrap(
      api.POST('/api/v1/appointments/{appointment_id}/cancel', {
        params: { path: { appointment_id: id } },
      }),
    ),
  )
}

/** UC18: `complete` or `no-show`, both answered with the item of the agenda. */
export function useRecordOutcome(id: string) {
  return useAgendaMutation((outcome: 'completed' | 'no_show') =>
    unwrap(
      outcome === 'completed'
        ? api.POST('/api/v1/appointments/{appointment_id}/complete', {
            params: { path: { appointment_id: id } },
          })
        : api.POST('/api/v1/appointments/{appointment_id}/no-show', {
            params: { path: { appointment_id: id } },
          }),
    ),
  )
}

/** The appointment as the agendas already read now know it, if any of them has it. */
export function findInAgendas(queryClient: QueryClient, id: string): StaffAppointment | undefined {
  for (const [, list] of queryClient.getQueriesData<StaffAppointment[]>({ queryKey: teamKeys.agendaAll })) {
    const found = list?.find((item) => item.id === id)
    if (found !== undefined) return found
  }
  return undefined
}
