import { setupServer } from 'msw/node'

import { authHandlers } from './auth'
import { handlers } from './handlers'
import { teamHandlers } from './team-agenda'
import { scheduleHandlers } from './work-schedule'

// The first match wins: the schedule routes, with state, come before the read-only ones of the agenda.
export const server = setupServer(...handlers, ...authHandlers, ...scheduleHandlers, ...teamHandlers)
