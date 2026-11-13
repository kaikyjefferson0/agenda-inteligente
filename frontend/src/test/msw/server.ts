import { setupServer } from 'msw/node'

import { authHandlers } from './auth'
import { configHandlers } from './configuration'
import { handlers } from './handlers'
import { teamHandlers } from './team-agenda'
import { scheduleHandlers } from './work-schedule'

// The first match wins: the schedule and configuration routes, with state, come before the
// read-only ones of the agenda (the team and the catalog start as the same data).
export const server = setupServer(...handlers, ...authHandlers, ...scheduleHandlers, ...configHandlers, ...teamHandlers)
