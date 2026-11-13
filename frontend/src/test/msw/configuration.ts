import { http, HttpResponse } from 'msw'

import type { components } from '@/api/schema'

import { authApi, meOf } from './auth'
import { API, problem } from './handlers'
import { teamOf, teamServices } from './team-agenda'

type Business = components['schemas']['BusinessData']
type Service = components['schemas']['ServiceData']
type Professional = components['schemas']['ProfessionalData']
type Scheduled = components['schemas']['AppointmentData']

const ME = meOf()

const defaultBusiness = (): Business => ({
  id: ME.business.id,
  name: ME.business.name,
  slug: ME.business.slug,
  timezone: ME.business.timezone,
  slot_step_minutes: 15,
  min_advance_minutes: 60,
  max_advance_days: 30,
  change_deadline_minutes: 120,
  is_demo: false,
})

/** The refusal the next request of a route answers, instead of its normal answer. */
type Refusal = { status: number; code: string; extra?: Record<string, unknown>; headers?: Record<string, string> }

/**
 * The configuration routes of the Owner (UC04 to UC07) with state: the
 * business, the catalog and the team change with each request, and each
 * body is kept. The team and the catalog start as those of the agenda, so
 * the other pages see the same data.
 */
export const configApi = {
  business: defaultBusiness(),
  services: null as Service[] | null,
  team: null as Professional[] | null,
  /** What the next `PATCH /business` answers in `appointments_outside_hours`. */
  outside: [] as Scheduled[],
  refuse: {} as Partial<Record<'business' | 'createService' | 'updateService' | 'invite' | 'serve' | 'deactivate' | 'setServices' | 'cancelInvite', Refusal>>,
  bodies: { business: [] as unknown[], services: [] as unknown[], invites: [] as unknown[], setServices: [] as unknown[] },
  calls: { patchBusiness: 0, createService: 0, updateService: 0, invite: 0, serve: 0, deactivate: 0, setServices: 0, cancelInvite: 0 },
  nextId: 1,

  reset() {
    this.business = defaultBusiness()
    this.services = null
    this.team = null
    this.outside = []
    this.refuse = {}
    this.bodies = { business: [], services: [], invites: [], setServices: [] }
    for (const key of Object.keys(this.calls) as (keyof typeof this.calls)[]) this.calls[key] = 0
    this.nextId = 1
  },

  catalog(): Service[] {
    this.services ??= teamServices.map((service) => ({ ...service }))
    return this.services
  },

  members(): Professional[] {
    this.team ??= teamOf('owner')
    return this.team
  },
}

function refused(route: keyof typeof configApi.refuse) {
  const refusal = configApi.refuse[route]
  if (refusal === undefined) return null
  delete configApi.refuse[route]
  return problem(refusal.status, refusal.code, refusal.extra, refusal.headers)
}

const newId = (prefix: string) => `${prefix}-0000-4000-8000-${String(configApi.nextId++).padStart(12, '0')}`

export const configHandlers = [
  http.get(`${API}/business`, () => HttpResponse.json(configApi.business)),
  http.patch(`${API}/business`, async ({ request }) => {
    configApi.calls.patchBusiness += 1
    const body = (await request.json()) as Partial<Business>
    configApi.bodies.business.push(body)
    const refusal = refused('business')
    if (refusal !== null) return refusal
    const changedZone = body.timezone !== undefined && body.timezone !== configApi.business.timezone
    configApi.business = { ...configApi.business, ...body }
    return HttpResponse.json({
      ...configApi.business,
      appointments_outside_hours: changedZone ? configApi.outside : [],
    })
  }),

  // The Professional reads only the own record, as the API (and the agenda handlers) do.
  http.get(`${API}/professionals`, () =>
    HttpResponse.json(authApi.role === 'owner' ? configApi.members() : teamOf('professional')),
  ),
  http.get(`${API}/services`, () => HttpResponse.json(configApi.catalog())),

  http.post(`${API}/services`, async ({ request }) => {
    configApi.calls.createService += 1
    const body = (await request.json()) as Omit<Service, 'id' | 'is_active' | 'preparation_minutes'> & {
      preparation_minutes?: number
    }
    configApi.bodies.services.push(body)
    const refusal = refused('createService')
    if (refusal !== null) return refusal
    const service: Service = { preparation_minutes: 0, ...body, id: newId('5e7c0000'), is_active: true }
    configApi.catalog().push(service)
    return HttpResponse.json(service, { status: 201 })
  }),
  http.patch(`${API}/services/:id`, async ({ params, request }) => {
    configApi.calls.updateService += 1
    const body = (await request.json()) as Partial<Service>
    configApi.bodies.services.push(body)
    const refusal = refused('updateService')
    if (refusal !== null) return refusal
    const current = configApi.catalog().find((service) => service.id === params.id)
    if (current === undefined) return problem(404, 'NOT_FOUND')
    Object.assign(current, body)
    return HttpResponse.json(current)
  }),

  http.post(`${API}/professionals/invitations`, async ({ request }) => {
    configApi.calls.invite += 1
    const body = (await request.json()) as { name: string; email: string }
    configApi.bodies.invites.push(body)
    const refusal = refused('invite')
    if (refusal !== null) return refusal
    const pending = configApi.members().find((member) => member.email === body.email && member.invitation_pending)
    const id = pending?.id ?? newId('9a0c1e2f')
    if (pending === undefined) {
      configApi.members().push({
        id,
        user_id: newId('7e1f0b6c'),
        name: body.name,
        email: body.email,
        is_bookable: false,
        is_active: true,
        invitation_pending: true,
        invitation_expires_at: '2026-11-19T16:00:00Z',
        service_ids: [],
      })
    } else pending.name = body.name
    // Seven days after Thursday 12/11/2026, 16:00 UTC (13:00 in São Paulo).
    return HttpResponse.json({ professional_id: id, email: body.email, expires_at: '2026-11-19T16:00:00Z' }, { status: 202 })
  }),
  http.post(`${API}/professionals/me`, () => {
    configApi.calls.serve += 1
    const refusal = refused('serve')
    if (refusal !== null) return refusal
    const own = configApi.members().find((member) => member.user_id === ME.user.id)
    if (own !== undefined) {
      own.is_bookable = true
      return HttpResponse.json(own)
    }
    const created: Professional = {
      id: newId('9a0c1e2f'),
      user_id: ME.user.id,
      name: ME.user.name,
      email: ME.user.email,
      is_bookable: true,
      is_active: true,
      invitation_pending: false,
      invitation_expires_at: null,
      service_ids: [],
    }
    configApi.members().push(created)
    return HttpResponse.json(created, { status: 201 })
  }),
  http.post(`${API}/professionals/:id/deactivate`, ({ params }) => {
    configApi.calls.deactivate += 1
    const refusal = refused('deactivate')
    if (refusal !== null) return refusal
    const member = configApi.members().find((item) => item.id === params.id)
    if (member === undefined) return problem(404, 'NOT_FOUND')
    member.is_bookable = false
    if (member.user_id !== ME.user.id) member.is_active = false
    return new HttpResponse(null, { status: 204 })
  }),
  http.delete(`${API}/professionals/:id/invitation`, ({ params }) => {
    configApi.calls.cancelInvite += 1
    const refusal = refused('cancelInvite')
    if (refusal !== null) return refusal
    const member = configApi.members().find((item) => item.id === params.id)
    if (member === undefined) return problem(404, 'NOT_FOUND')
    if (!member.invitation_pending) return problem(409, 'INVITATION_NOT_PENDING')
    configApi.team = configApi.members().filter((item) => item.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
  http.put(`${API}/professionals/:id/services`, async ({ params, request }) => {
    configApi.calls.setServices += 1
    const body = (await request.json()) as { service_ids: string[] }
    configApi.bodies.setServices.push(body)
    const refusal = refused('setServices')
    if (refusal !== null) return refusal
    const member = configApi.members().find((item) => item.id === params.id)
    if (member === undefined) return problem(404, 'NOT_FOUND')
    member.service_ids = [...new Set(body.service_ids)]
    return HttpResponse.json(member)
  }),
]
