import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { expect } from 'vitest'

import { createQueryClient } from '@/api/query-client'
import { Providers } from '@/app/providers'
import { routes } from '@/app/router'

import { withOpenSession } from './session'

/**
 * A page of the panel, open with a session of `role`, through the real
 * router (with the loader of the panel, D73, and the redirect by role, D74).
 * Waits for the `h1` of the page: the panel group is loaded on demand (D54),
 * and the first import, under the load of the whole suite, takes longer.
 */
export async function renderPanel(path: string, role: 'owner' | 'professional', heading: string) {
  await withOpenSession(role)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  const queryClient = createQueryClient({ queries: { retry: false } })
  render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  )
  // The first opening of the panel in each test: its group is loaded on demand (D54) and, cold and
  // under the load of the whole suite, takes longer than the default wait of setup.ts.
  await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 10_000 })
  // The frame of the page shows its title while it reads who is in: wait for the page itself.
  await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull())
  return { router, user, queryClient }
}
