import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import { schedulingKeys, teamKeys } from '@/features/scheduling'

import type { BusinessChanges, BusinessSettings } from './settings-draft'

/** UC05, only for the Owner, under `['team']` with the rest of the panel (D93). */
export const businessSettingsQuery = queryOptions({
  queryKey: teamKeys.business,
  queryFn: ({ signal }) => unwrap(api.GET('/api/v1/business', { signal })),
})

/**
 * What a change of the business reaches (D93): everything the panel read
 * (`['team']`: a new time zone moves the weeks of the agenda and the hours of
 * every list) and every public page, under the old slug and the new one. The
 * session data (`GET /auth/me`, with the name, the slug and the time zone)
 * belongs to `auth`, so the page refreshes it through `onSettled`.
 */
export function useUpdateBusiness(onSettled?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: BusinessChanges) => unwrap(api.PATCH('/api/v1/business', { body: changes })),
    onSuccess: (answer) => {
      const settings: BusinessSettings & { appointments_outside_hours?: unknown } = { ...answer }
      delete settings.appointments_outside_hours
      queryClient.setQueryData<BusinessSettings>(teamKeys.business, settings)
    },
    onSettled: () => {
      onSettled?.()
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: teamKeys.all }),
        queryClient.invalidateQueries({ queryKey: schedulingKeys.all }),
      ])
    },
  })
}
