import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'

import { Providers } from '@/app/providers'
import { createAppRouter } from '@/app/router'
import { getAppSession } from '@/features/auth/session/session'
import { syncColorScheme } from '@/lib/color-scheme'

import './index.css'

syncColorScheme()
// UC02: one silent renewal on opening the site, shared with the other tabs (D70, D71).
void getAppSession().start()

const router = createAppRouter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
