import { setupServer } from 'msw/node'

import { authHandlers } from './auth'
import { handlers } from './handlers'

export const server = setupServer(...handlers, ...authHandlers)
