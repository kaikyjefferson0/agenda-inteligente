import { http, HttpResponse } from 'msw'

import type { components } from '@/api/schema'

/** Origin of the API in the tests (`VITE_API_BASE_URL` in vite.config.ts). */
export const API = 'http://api.test/api/v1'

type PublicBusiness = components['schemas']['PublicBusinessResponse']
type Booking = components['schemas']['BookingResponse']
type CreateBooking = components['schemas']['CreateBookingRequest']

export const PROFESSIONAL_ID = '5d0c7e42-0000-4000-8000-000000000002'
export const OWNER_ID = '5d0c7e42-0000-4000-8000-000000000003'
/** One professional: the professional step is skipped. */
export const SERVICE_ID = '2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20'
/** Two professionals: the professional step is shown. */
export const TEAM_SERVICE_ID = '2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c21'
/** Active, but nobody does it yet: shown, but not bookable. */
export const EMPTY_SERVICE_ID = '2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c22'

export const demoBusiness: PublicBusiness = {
  name: 'Barbearia Demo',
  slug: 'barbearia-demo',
  timezone: 'America/Sao_Paulo',
  is_demo: true,
  min_advance_minutes: 60,
  max_advance_days: 30,
  services: [
    {
      id: SERVICE_ID,
      name: 'Corte',
      duration_minutes: 30,
      price_cents: 5000,
      professional_ids: [PROFESSIONAL_ID],
    },
    {
      id: TEAM_SERVICE_ID,
      name: 'Corte e barba',
      duration_minutes: 90,
      price_cents: 8000,
      professional_ids: [PROFESSIONAL_ID, OWNER_ID],
    },
    {
      id: EMPTY_SERVICE_ID,
      name: 'Coloração',
      duration_minutes: 60,
      price_cents: 12000,
      professional_ids: [],
    },
  ],
  professionals: [
    { id: PROFESSIONAL_ID, name: 'Profissional Demo' },
    { id: OWNER_ID, name: 'Dono Demo' },
  ],
}

/** Slots of a local day of São Paulo, as the public routes send them (with offset). */
export function slotsOf(date: string, times: string[] = ['09:00', '14:00', '18:30']) {
  return times.map((time) => ({ starts_at: `${date}T${time}:00-03:00` }))
}

const MINUTE = 60_000

/** What `POST /public/businesses/{slug}/appointments` answers for `body`. */
export function bookingFor(body: CreateBooking, overrides: Partial<Booking> = {}): Booking {
  const service = demoBusiness.services.find((item) => item.id === body.service_id)!
  const professionalId = body.professional_id ?? PROFESSIONAL_ID
  const professional = demoBusiness.professionals.find((item) => item.id === professionalId)!
  const ends = new Date(Date.parse(body.starts_at) + service.duration_minutes * MINUTE)
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    status: 'confirmed',
    starts_at: body.starts_at,
    ends_at: ends.toISOString(),
    service: { name: service.name, price_cents: service.price_cents },
    professional: { name: professional.name },
    access_url: 'https://app.exemplo.com/agendamento/token-de-teste',
    email_status: 'queued',
    ...overrides,
  }
}

/** A problem+json response, as `app/api/errors.py` builds it. */
export function problem(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return HttpResponse.json(
    {
      type: `https://api.exemplo.com/problems/${code.toLowerCase().replaceAll('_', '-')}`,
      title: 'Título',
      status,
      code,
      detail: 'Detalhe.',
      ...extra,
    },
    { status, headers: { 'Content-Type': 'application/problem+json', ...headers } },
  )
}

/** Default handlers; each test overrides what it needs with `server.use`. */
export const handlers = [
  http.get(`${API}/public/businesses/:slug`, ({ params }) =>
    params.slug === demoBusiness.slug
      ? HttpResponse.json(demoBusiness)
      : problem(404, 'NOT_FOUND'),
  ),
  http.get(`${API}/public/businesses/:slug/availability`, ({ request }) => {
    const date = new URL(request.url).searchParams.get('date') ?? ''
    return HttpResponse.json({ date, slots: slotsOf(date) })
  }),
  http.post(`${API}/public/businesses/:slug/appointments`, async ({ request }) =>
    HttpResponse.json(bookingFor((await request.json()) as CreateBooking), { status: 201 }),
  ),
]
