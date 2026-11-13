import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import { schedulingKeys, teamKeys } from '@/features/scheduling'

import type { CreateServiceBody, Service, UpdateServiceBody } from './service-draft'

/**
 * What a change in the catalog reaches (D93): the list of services, the
 * agenda (`service_name` is the current name) and every public page of the
 * business, which lists the active services. Also on a refusal, which may
 * mean the screen was old. Changes are never retried (D53).
 */
function invalidateCatalog(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: teamKeys.services }),
    queryClient.invalidateQueries({ queryKey: teamKeys.agendaAll }),
    queryClient.invalidateQueries({ queryKey: schedulingKeys.all }),
  ])
}

/** The answer replaces the service in the list at once, before the new read. */
function keep(queryClient: QueryClient, service: Service) {
  queryClient.setQueryData<Service[]>(teamKeys.services, (list) => {
    if (list === undefined) return list
    return list.some((item) => item.id === service.id)
      ? list.map((item) => (item.id === service.id ? service : item))
      : [...list, service]
  })
}

export function useCreateService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateServiceBody) => unwrap(api.POST('/api/v1/services', { body })),
    onSuccess: (service) => keep(queryClient, service),
    onSettled: () => invalidateCatalog(queryClient),
  })
}

export function useUpdateService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: UpdateServiceBody }) =>
      unwrap(api.PATCH('/api/v1/services/{service_id}', { params: { path: { service_id: id } }, body: changes })),
    onSuccess: (service) => keep(queryClient, service),
    onSettled: () => invalidateCatalog(queryClient),
  })
}
