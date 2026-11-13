import { http, HttpResponse } from 'msw'

import type { components } from '@/api/schema'

import { authApi } from './auth'
import { API, problem } from './handlers'
import { BRUNO_ID, teamApi, WORKING_INTERVALS } from './team-agenda'

type Interval = components['schemas']['WorkingHoursInterval']
type Scheduled = components['schemas']['AppointmentData']
type CreateBlock = components['schemas']['CreateTimeBlockRequest']

/**
 * The working hours and blocks routes with state (UC08, UC09). The blocks
 * are those of `teamApi`, so the agenda sees them too. A Professional may
 * only touch Bruno's schedule, as the API (`FORBIDDEN`).
 */
export const scheduleApi = {
  hours: new Map<string, Interval[]>(),
  /** What the next `PUT` answers in `appointments_outside_hours`. */
  outside: [] as Scheduled[],
  /** The next `POST /time-blocks` answers this `409` instead of creating. */
  refuseBlock: null as null | { code: 'APPOINTMENT_CONFLICTS'; conflicts: Scheduled[] } | { code: 'TIME_BLOCK_OVERLAP' },
  puts: [] as Interval[][],
  blockBodies: [] as CreateBlock[],
  deletes: [] as string[],
  nextBlock: 1,

  reset() {
    this.hours = new Map()
    this.outside = []
    this.refuseBlock = null
    this.puts = []
    this.blockBodies = []
    this.deletes = []
    this.nextBlock = 1
  },
}

const allowed = (professionalId: string) => authApi.role === 'owner' || professionalId === BRUNO_ID

const blockId = (n: number) => `b10c0000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const scheduleHandlers = [
  http.get(`${API}/professionals/:id/working-hours`, ({ params }) => {
    const id = String(params.id)
    if (!allowed(id)) return problem(403, 'FORBIDDEN')
    return HttpResponse.json({ intervals: scheduleApi.hours.get(id) ?? WORKING_INTERVALS })
  }),
  http.put(`${API}/professionals/:id/working-hours`, async ({ params, request }) => {
    const id = String(params.id)
    if (!allowed(id)) return problem(403, 'FORBIDDEN')
    const { intervals } = (await request.json()) as { intervals: Interval[] }
    scheduleApi.puts.push(intervals)
    scheduleApi.hours.set(id, intervals)
    return HttpResponse.json({ intervals, appointments_outside_hours: scheduleApi.outside })
  }),
  http.get(`${API}/professionals/:id/time-blocks`, ({ params }) => {
    const id = String(params.id)
    if (!allowed(id)) return problem(403, 'FORBIDDEN')
    return HttpResponse.json(teamApi.blocks.filter((block) => block.professional_id === id))
  }),
  http.post(`${API}/professionals/:id/time-blocks`, async ({ params, request }) => {
    const id = String(params.id)
    if (!allowed(id)) return problem(403, 'FORBIDDEN')
    const body = (await request.json()) as CreateBlock
    scheduleApi.blockBodies.push(body)
    const refusal = scheduleApi.refuseBlock
    if (refusal !== null) {
      scheduleApi.refuseBlock = null
      return refusal.code === 'APPOINTMENT_CONFLICTS'
        ? problem(409, refusal.code, { conflicts: refusal.conflicts })
        : problem(409, refusal.code)
    }
    const block = { id: blockId(scheduleApi.nextBlock++), professional_id: id, ...body }
    teamApi.blocks.push(block)
    return HttpResponse.json(block, { status: 201 })
  }),
  http.delete(`${API}/time-blocks/:id`, ({ params }) => {
    const id = String(params.id)
    scheduleApi.deletes.push(id)
    const block = teamApi.blocks.find((item) => item.id === id)
    if (block === undefined) return problem(404, 'NOT_FOUND')
    if (!allowed(block.professional_id)) return problem(403, 'FORBIDDEN')
    teamApi.blocks = teamApi.blocks.filter((item) => item.id !== id)
    return new HttpResponse(null, { status: 204 })
  }),
]
