import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { schedulingKeys, teamKeys, type Professional } from '@/features/scheduling'

export type InviteBody = components['schemas']['InviteProfessionalRequest']
export type Invitation = components['schemas']['InvitationResponse']

/**
 * What a change in the team reaches (D93): the team, the agenda (its names
 * and columns) and every public page of the business, which lists who can be
 * booked (RN07). Also on a refusal, which may mean the screen was old.
 * Changes are never retried (D53).
 */
function invalidateTeam(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: teamKeys.professionals }),
    queryClient.invalidateQueries({ queryKey: teamKeys.agendaAll }),
    queryClient.invalidateQueries({ queryKey: schedulingKeys.all }),
  ])
}

/** The answer replaces the professional in the list at once, before the new read. */
function keep(queryClient: QueryClient, professional: Professional) {
  queryClient.setQueryData<Professional[]>(teamKeys.professionals, (list) => {
    if (list === undefined) return list
    return list.some((item) => item.id === professional.id)
      ? list.map((item) => (item.id === professional.id ? professional : item))
      : [...list, professional]
  })
}

/** UC04: `202`, also to renew the link of a pending invite (RN24). */
export function useInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: InviteBody) => unwrap(api.POST('/api/v1/professionals/invitations', { body })),
    onSettled: () => invalidateTeam(queryClient),
  })
}

/**
 * "Também atendo": `201` creates the record of the Owner, `200` brings it
 * back to the bookings; both with `ProfessionalData` (D91, D94).
 */
export function useStartServing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/professionals/me')),
    onSuccess: (professional) => keep(queryClient, professional),
    onSettled: () => invalidateTeam(queryClient),
  })
}

/** RN23: `409 APPOINTMENT_CONFLICTS` while there are future confirmed appointments. */
export function useDeactivate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (professionalId: string) =>
      unwrap(
        api.POST('/api/v1/professionals/{professional_id}/deactivate', {
          params: { path: { professional_id: professionalId } },
        }),
      ),
    onSettled: (_data, _error, professionalId) =>
      Promise.all([
        invalidateTeam(queryClient),
        queryClient.invalidateQueries({ queryKey: teamKeys.workingHours(professionalId) }),
      ]),
  })
}

/** UC07: the list replaces the previous one; an inactive service is accepted (RN07). */
export function useSetServices(professionalId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serviceIds: string[]) =>
      unwrap(
        api.PUT('/api/v1/professionals/{professional_id}/services', {
          params: { path: { professional_id: professionalId } },
          body: { service_ids: serviceIds },
        }),
      ),
    onSuccess: (professional) => keep(queryClient, professional),
    onSettled: () =>
      Promise.all([invalidateTeam(queryClient), queryClient.invalidateQueries({ queryKey: teamKeys.services })]),
  })
}

/**
 * D96 and D98: `DELETE /professionals/{id}/invitation` (`204`) deletes the
 * pending account with its record, services, working hours and blocks; the
 * link stops working and the e-mail is free for a new invite. The answer
 * takes the person out of the list at once, before the new read.
 */
export function useCancelInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (professionalId: string) =>
      unwrap(
        api.DELETE('/api/v1/professionals/{professional_id}/invitation', {
          params: { path: { professional_id: professionalId } },
        }),
      ),
    onSuccess: (_data, professionalId) => {
      queryClient.setQueryData<Professional[]>(teamKeys.professionals, (list) =>
        list?.filter((item) => item.id !== professionalId),
      )
      queryClient.removeQueries({ queryKey: teamKeys.workingHours(professionalId) })
      queryClient.removeQueries({ queryKey: teamKeys.timeBlocks(professionalId) })
    },
    onSettled: () => invalidateTeam(queryClient),
  })
}
