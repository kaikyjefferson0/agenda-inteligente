import { queryOptions, useMutation } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'

import { getAppSession, type LoginBody } from './session/session'

export type Me = components['schemas']['MeResponse']
export type UserRole = components['schemas']['UserRole']

export const authKeys = {
  me: ['auth', 'me'] as const,
}

/** User, business and role of the session (`GET /auth/me`). */
export const meQuery = queryOptions({
  queryKey: authKeys.me,
  queryFn: () => unwrap(api.GET('/api/v1/auth/me')),
  staleTime: 5 * 60_000,
})

export function useLogin() {
  return useMutation({ mutationFn: (body: LoginBody) => getAppSession().login(body) })
}

export function useLogout() {
  return useMutation({ mutationFn: () => getAppSession().logout() })
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) =>
      unwrap(api.POST('/api/v1/auth/password/forgot', { body: { email } })),
  })
}

/** `204`: the API revoked every session of the account, so every tab leaves. */
export function useResetPassword(token: string) {
  return useMutation({
    mutationFn: async (password: string) => {
      await api.POST('/api/v1/auth/password/reset', { body: { token, new_password: password } })
    },
    onSuccess: () => getAppSession().end('password-reset'),
  })
}

export function useAcceptInvitation(token: string) {
  return useMutation({
    mutationFn: async (password: string) => {
      await api.POST('/api/v1/auth/invitations/accept', { body: { token, password } })
    },
  })
}
