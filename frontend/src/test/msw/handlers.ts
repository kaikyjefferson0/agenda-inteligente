import { http, HttpResponse } from 'msw'

import type { components } from '@/api/schema'

/** Origin of the API in the tests (`VITE_API_BASE_URL` in vite.config.ts). */
export const API = 'http://api.test/api/v1'

type PublicBusiness = components['schemas']['PublicBusinessResponse']

export const demoBusiness: PublicBusiness = {
  name: 'Barbearia Demo',
  slug: 'barbearia-demo',
  timezone: 'America/Sao_Paulo',
  is_demo: true,
  min_advance_minutes: 60,
  max_advance_days: 30,
  services: [
    {
      id: '2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20',
      name: 'Corte',
      duration_minutes: 30,
      price_cents: 5000,
      professional_ids: ['5d0c7e42-0000-4000-8000-000000000002'],
    },
  ],
  professionals: [{ id: '5d0c7e42-0000-4000-8000-000000000002', name: 'Profissional Demo' }],
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
]
