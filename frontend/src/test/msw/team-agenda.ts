import { http, HttpResponse } from 'msw'

import type { components } from '@/api/schema'

import { authApi, meOf } from './auth'
import { API, problem } from './handlers'

type Appointment = components['schemas']['StaffAppointmentData']
type Professional = components['schemas']['ProfessionalData']
type Service = components['schemas']['ServiceData']
type TimeBlock = components['schemas']['TimeBlockData']
type CreateBody = components['schemas']['CreateAppointmentRequest']
type RescheduleBody = components['schemas']['StaffRescheduleRequest']

/** The user of `meOf()`, the same for both roles of the tests. */
const ME = meOf().user.id

export const ANA_ID = '9a0c1e2f-0000-4000-8000-00000000000a'
export const BRUNO_ID = '9a0c1e2f-0000-4000-8000-00000000000b'
export const CARLA_ID = '9a0c1e2f-0000-4000-8000-00000000000c'
export const CORTE_ID = '3b1d2e4f-0000-4000-8000-000000000001'
export const BARBA_ID = '3b1d2e4f-0000-4000-8000-000000000002'
export const COLOR_ID = '3b1d2e4f-0000-4000-8000-000000000003'

export const teamServices: Service[] = [
  { id: CORTE_ID, name: 'Corte', duration_minutes: 30, preparation_minutes: 10, price_cents: 5000, is_active: true },
  { id: BARBA_ID, name: 'Barba', duration_minutes: 20, preparation_minutes: 0, price_cents: 3500, is_active: true },
  { id: COLOR_ID, name: 'Coloração', duration_minutes: 60, preparation_minutes: 15, price_cents: 12000, is_active: false },
]

function professional(overrides: Partial<Professional> & Pick<Professional, 'id' | 'name'>): Professional {
  return {
    user_id: `${overrides.id.slice(0, -1)}f`,
    email: `${overrides.name.split(' ')[0].toLowerCase()}@exemplo.com`,
    is_bookable: true,
    is_active: true,
    invitation_pending: false,
    invitation_expires_at: null,
    service_ids: [CORTE_ID],
    ...overrides,
  }
}

/** The Owner serves too (D43); Carla left the team. */
export function teamOf(role: 'owner' | 'professional'): Professional[] {
  if (role === 'professional') {
    return [professional({ id: BRUNO_ID, name: 'Bruno Lima', user_id: ME })]
  }
  return [
    professional({ id: ANA_ID, name: 'Dona Ana', user_id: ME, service_ids: [CORTE_ID, BARBA_ID] }),
    professional({ id: BRUNO_ID, name: 'Bruno Lima' }),
    professional({ id: CARLA_ID, name: 'Carla Souza', is_active: false, is_bookable: false }),
  ]
}

/** Monday to Saturday, 09:00–12:00 and 13:00–19:00; closed on Sunday. */
export const WORKING_INTERVALS = [0, 1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, start_time: '09:00', end_time: '12:00' },
  { weekday, start_time: '13:00', end_time: '19:00' },
])

const MINUTE = 60_000

/** An appointment at a local time of São Paulo (UTC−3 in November 2026), in UTC as the API sends it. */
export function staffAppointment(
  overrides: Partial<Appointment> & { id: string; local: string },
): Appointment {
  const { local, ...rest } = overrides
  const service = teamServices.find((item) => item.id === (rest.service_id ?? CORTE_ID))!
  const start = Date.parse(`${local}:00-03:00`)
  const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')
  return {
    professional_id: BRUNO_ID,
    service_id: service.id,
    service_name: service.name,
    starts_at: iso(start),
    ends_at: iso(start + service.duration_minutes * MINUTE),
    blocked_until: iso(start + (service.duration_minutes + service.preparation_minutes) * MINUTE),
    duration_minutes: service.duration_minutes,
    preparation_minutes: service.preparation_minutes,
    price_cents: service.price_cents,
    status: 'confirmed',
    origin: 'public',
    customer_name: 'Cliente',
    customer_email: 'cliente@example.com',
    customer_phone: '+5511999999999',
    cancelled_at: null,
    ...rest,
  }
}

const id = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`

/**
 * Thursday 12/11/2026 in São Paulo (the "today" of the tests, at 13:00):
 * one done, one started and waiting for its result, two to come, one
 * cancelled; and one on Friday.
 */
export function defaultAgenda(): Appointment[] {
  return [
    staffAppointment({ id: id(1), local: '2026-11-12T09:00', professional_id: ANA_ID, customer_name: 'Carlos Dias', status: 'completed' }),
    staffAppointment({ id: id(2), local: '2026-11-12T11:00', customer_name: 'Diego Rocha' }),
    staffAppointment({ id: id(3), local: '2026-11-12T14:00', customer_name: 'Elisa Prado', customer_email: null, customer_phone: null, origin: 'staff' }),
    staffAppointment({ id: id(4), local: '2026-11-12T15:00', professional_id: ANA_ID, service_id: BARBA_ID, customer_name: 'Fábio Nunes' }),
    staffAppointment({ id: id(5), local: '2026-11-12T16:00', customer_name: 'Gabi Lopes', status: 'cancelled', cancelled_at: '2026-11-11T12:00:00Z' }),
    staffAppointment({ id: id(6), local: '2026-11-13T10:00', professional_id: ANA_ID, customer_name: 'Helena Reis' }),
  ]
}

export const APPOINTMENT_IDS = { done: id(1), started: id(2), next: id(3), barba: id(4), cancelled: id(5), friday: id(6) }

/**
 * The team routes with state: the agenda of the tests, what each request
 * asked for, and the changes made to it.
 */
export const teamApi = {
  appointments: defaultAgenda(),
  blocks: [] as TimeBlock[],
  agendaRequests: [] as URLSearchParams[],
  bodies: [] as unknown[],
  calls: { create: 0, reschedule: 0, cancel: 0, complete: 0, noShow: 0 },
  nextId: 100,

  reset() {
    this.appointments = defaultAgenda()
    this.blocks = []
    this.agendaRequests = []
    this.bodies = []
    this.nextId = 100
    for (const key of Object.keys(this.calls) as (keyof typeof this.calls)[]) this.calls[key] = 0
  },

  find(appointmentId: string) {
    return this.appointments.find((item) => item.id === appointmentId)
  },

  replace(next: Appointment) {
    this.appointments = this.appointments.map((item) => (item.id === next.id ? next : item))
    return next
  },
}

function visibleTo(appointment: Appointment) {
  return authApi.role === 'owner' || appointment.professional_id === BRUNO_ID
}

function moved(appointment: Appointment, startsAt: string, professionalId: string): Appointment {
  const start = Date.parse(startsAt)
  const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')
  return {
    ...appointment,
    professional_id: professionalId,
    starts_at: iso(start),
    ends_at: iso(start + appointment.duration_minutes * MINUTE),
    blocked_until: iso(start + (appointment.duration_minutes + appointment.preparation_minutes) * MINUTE),
  }
}

const emailStatusOf = (appointment: Appointment) => (appointment.customer_email === null ? 'none' : 'queued')

/** A `409 SLOT_UNAVAILABLE` of the team routes, with its `reason` (D77). */
export function slotRefused(reason: components['schemas']['SlotRefusal']) {
  return problem(409, 'SLOT_UNAVAILABLE', { reason, detail: 'Detalhe em português.' })
}

export const teamHandlers = [
  http.get(`${API}/professionals`, () => HttpResponse.json(teamOf(authApi.role))),
  http.get(`${API}/services`, () => HttpResponse.json(teamServices)),
  http.get(`${API}/professionals/:id/working-hours`, () => HttpResponse.json({ intervals: WORKING_INTERVALS })),
  http.get(`${API}/professionals/:id/time-blocks`, ({ params }) =>
    HttpResponse.json(teamApi.blocks.filter((block) => block.professional_id === params.id)),
  ),
  http.get(`${API}/appointments`, ({ request }) => {
    const query = new URL(request.url).searchParams
    teamApi.agendaRequests.push(query)
    const from = Date.parse(query.get('from') ?? '')
    const to = Date.parse(query.get('to') ?? '')
    if (!(to > from) || to - from > 31 * 24 * 60 * MINUTE) return problem(422, 'VALIDATION_ERROR')
    const professionalId = query.get('professional_id')
    if (authApi.role === 'professional' && professionalId !== null && professionalId !== BRUNO_ID) {
      return problem(403, 'FORBIDDEN')
    }
    return HttpResponse.json(
      teamApi.appointments.filter((item) => {
        const start = Date.parse(item.starts_at)
        return (
          visibleTo(item) &&
          start >= from &&
          start < to &&
          (professionalId === null || item.professional_id === professionalId)
        )
      }),
    )
  }),
  http.post(`${API}/appointments`, async ({ request }) => {
    teamApi.calls.create += 1
    const body = (await request.json()) as CreateBody
    teamApi.bodies.push(body)
    const service = teamServices.find((item) => item.id === body.service_id)!
    const created = moved(
      staffAppointment({
        id: id(teamApi.nextId++),
        local: '2026-01-01T00:00',
        service_id: service.id,
        origin: 'staff',
        customer_name: body.customer.name,
        customer_email: body.customer.email ?? null,
        customer_phone: body.customer.phone ?? null,
      }),
      body.starts_at,
      body.professional_id,
    )
    teamApi.appointments.push(created)
    const status = emailStatusOf(created)
    return HttpResponse.json(
      {
        ...created,
        access_url: status === 'none' ? null : 'https://app.exemplo.com/agendamento/token-novo',
        email_status: status,
      },
      { status: 201 },
    )
  }),
  http.post(`${API}/appointments/:id/reschedule`, async ({ params, request }) => {
    teamApi.calls.reschedule += 1
    const body = (await request.json()) as RescheduleBody
    teamApi.bodies.push(body)
    const current = teamApi.find(String(params.id))
    if (current === undefined) return problem(404, 'NOT_FOUND')
    if (current.status !== 'confirmed') return problem(409, 'INVALID_STATUS_TRANSITION')
    const next = teamApi.replace(moved(current, body.starts_at, body.professional_id ?? current.professional_id))
    return HttpResponse.json({ ...next, email_status: emailStatusOf(next) })
  }),
  http.post(`${API}/appointments/:id/cancel`, ({ params }) => {
    teamApi.calls.cancel += 1
    const current = teamApi.find(String(params.id))
    if (current === undefined) return problem(404, 'NOT_FOUND')
    if (current.status !== 'confirmed') return problem(409, 'INVALID_STATUS_TRANSITION')
    const next = teamApi.replace({ ...current, status: 'cancelled', cancelled_at: new Date().toISOString() })
    return HttpResponse.json({ ...next, email_status: emailStatusOf(next) })
  }),
  ...(['complete', 'no-show'] as const).map((action) =>
    http.post(`${API}/appointments/:id/${action}`, ({ params }) => {
      teamApi.calls[action === 'complete' ? 'complete' : 'noShow'] += 1
      const current = teamApi.find(String(params.id))
      if (current === undefined) return problem(404, 'NOT_FOUND')
      if (current.status !== 'confirmed' || Date.now() < Date.parse(current.starts_at)) {
        return problem(409, 'INVALID_STATUS_TRANSITION')
      }
      return HttpResponse.json(
        teamApi.replace({ ...current, status: action === 'complete' ? 'completed' : 'no_show' }),
      )
    }),
  ),
]
