import { createBrowserRouter, type RouteObject } from 'react-router'

import { PageLoader } from '@/components/feedback/PageLoader'
import { RouteError } from '@/components/feedback/RouteError'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { requireSession } from '@/features/auth/guard'
import NotFoundPage from '@/pages/NotFoundPage'

/**
 * Routes (D54). Each group is one chunk loaded on demand (public, account and
 * panel) and has its own `errorElement`. The layout of the public pages and the
 * 404 page stay in the main bundle.
 */

const publicPages = () => import('@/pages/public')
const accountPages = () => import('@/pages/account')
const panelPages = () => import('@/pages/panel')

/** Paths of the links sent by e-mail (app/services in the backend). */
export const PATHS = {
  home: '/',
  business: (slug: string) => `/n/${slug}`,
  customerAppointment: (token: string) => `/agendamento/${token}`,
  login: '/entrar',
  forgotPassword: '/esqueci-senha',
  invitation: (token: string) => `/convite/${token}`,
  resetPassword: (token: string) => `/recuperar-senha/${token}`,
  panel: '/painel',
} as const

export const routes: RouteObject[] = [
  {
    id: 'root',
    HydrateFallback: PageLoader,
    errorElement: <RouteError />,
    children: [
      {
        id: 'public',
        Component: PublicLayout,
        errorElement: <RouteError />,
        children: [
          {
            index: true,
            lazy: async () => ({ Component: (await publicPages()).HomePage }),
          },
          {
            path: 'n/:slug',
            lazy: async () => ({ Component: (await publicPages()).BusinessPage }),
          },
          {
            path: 'agendamento/:token',
            lazy: async () => ({ Component: (await publicPages()).CustomerAppointmentPage }),
          },
        ],
      },
      {
        id: 'account',
        Component: PublicLayout,
        errorElement: <RouteError />,
        children: [
          {
            path: 'entrar',
            lazy: async () => ({ Component: (await accountPages()).LoginPage }),
          },
          {
            path: 'esqueci-senha',
            lazy: async () => ({ Component: (await accountPages()).ForgotPasswordPage }),
          },
          {
            path: 'convite/:token',
            lazy: async () => ({ Component: (await accountPages()).InvitationPage }),
          },
          {
            path: 'recuperar-senha/:token',
            lazy: async () => ({ Component: (await accountPages()).ResetPasswordPage }),
          },
        ],
      },
      {
        id: 'panel',
        path: 'painel',
        // Without a session, the loader sends to `/entrar?voltar=…` (D73).
        lazy: async () => {
          const pages = await panelPages()
          return { loader: requireSession, Component: pages.ProtectedPanelLayout }
        },
        errorElement: <RouteError />,
        children: [
          {
            index: true,
            lazy: async () => ({ Component: (await panelPages()).AgendaPage }),
          },
          {
            path: 'servicos',
            lazy: async () => ({ Component: (await panelPages()).ServicesPage }),
          },
          {
            path: 'equipe',
            lazy: async () => ({ Component: (await panelPages()).TeamPage }),
          },
          {
            path: 'expediente',
            lazy: async () => ({ Component: (await panelPages()).WorkingHoursPage }),
          },
          {
            path: 'bloqueios',
            lazy: async () => ({ Component: (await panelPages()).TimeBlocksPage }),
          },
          {
            path: 'negocio',
            lazy: async () => ({ Component: (await panelPages()).BusinessSettingsPage }),
          },
        ],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
]

export function createAppRouter() {
  return createBrowserRouter(routes)
}
