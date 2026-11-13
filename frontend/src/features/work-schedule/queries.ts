import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { teamKeys, type WorkingInterval } from '@/features/scheduling'

export type WorkingHoursUpdate = components['schemas']['ReplaceWorkingHoursResponse']
export type CreateTimeBlockBody = components['schemas']['CreateTimeBlockRequest']

/**
 * The working hours and the blocks feed the manual booking of the agenda
 * (D82), which reads them under the same keys: every change invalidates them
 * and the agenda (`['team', 'agenda']`), also on a refusal, which may mean the
 * screen was old. Changes are never retried (D53).
 */
function useScheduleMutation<Variables, Result>(
  professionalId: string,
  send: (variables: Variables) => Promise<Result>,
  onSuccess?: (result: Result) => void,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: send,
    onSuccess,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: teamKeys.workingHours(professionalId) }),
        queryClient.invalidateQueries({ queryKey: teamKeys.timeBlocks(professionalId) }),
        queryClient.invalidateQueries({ queryKey: teamKeys.agendaAll }),
      ]),
  })
}

/** UC08: the `PUT` replaces the whole week (RN22). */
export function useSaveWorkingHours(professionalId: string) {
  const queryClient = useQueryClient()
  return useScheduleMutation(
    professionalId,
    (intervals: WorkingInterval[]) =>
      unwrap(
        api.PUT('/api/v1/professionals/{professional_id}/working-hours', {
          params: { path: { professional_id: professionalId } },
          body: { intervals },
        }),
      ),
    (result) =>
      queryClient.setQueryData(teamKeys.workingHours(professionalId), { intervals: result.intervals }),
  )
}

export function useCreateTimeBlock(professionalId: string) {
  return useScheduleMutation(professionalId, (body: CreateTimeBlockBody) =>
    unwrap(
      api.POST('/api/v1/professionals/{professional_id}/time-blocks', {
        params: { path: { professional_id: professionalId } },
        body,
      }),
    ),
  )
}

export function useDeleteTimeBlock(professionalId: string) {
  return useScheduleMutation(professionalId, (timeBlockId: string) =>
    unwrap(
      api.DELETE('/api/v1/time-blocks/{time_block_id}', {
        params: { path: { time_block_id: timeBlockId } },
      }),
    ),
  )
}
