import { setupServer } from 'msw/node'

import { authHandlers } from './auth'
import { handlers } from './handlers'
import { teamHandlers } from './team-agenda'

export const server = setupServer(...handlers, ...authHandlers, ...teamHandlers)
