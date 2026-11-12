import { describe, expect, it } from 'vitest'

import { ApiError, NetworkError } from '@/api/errors'
import { demoBusiness, linkAppointment, OWNER_ID, PROFESSIONAL_ID, SERVICE_ID } from '@/test/msw/handlers'

import { isFinalRefusal } from './outcome'
import { rescheduleOptions } from './reschedule'

const TODAY = '2026-11-10'

function apiError(status: number, code: string | null) {
  return new ApiError({ status, code, title: '', detail: null, fieldErrors: [], retryAfterSeconds: null, body: null })
}

describe('rescheduleOptions (D68)', () => {
  it('starts with the current professional and the current day', () => {
    const options = rescheduleOptions(demoBusiness, linkAppointment(), TODAY)

    expect(options.service?.name).toBe('Corte e barba')
    expect(options.professionals.map((item) => item.id)).toEqual([PROFESSIONAL_ID, OWNER_ID])
    expect(options.initialProfessionalId).toBe(PROFESSIONAL_ID)
    expect(options.initialDay).toBe('2026-11-12')
    expect(options.days[0]).toBe(TODAY)
    expect(options.days).toHaveLength(demoBusiness.max_advance_days + 1)
  })

  it('starts with "any professional" when the current one is no longer bookable', () => {
    const options = rescheduleOptions(
      demoBusiness,
      linkAppointment({ service: { id: SERVICE_ID, name: 'Corte', duration_minutes: 30, price_cents: 5000 }, professional: { id: OWNER_ID, name: 'Dono Demo' } }),
      TODAY,
    )

    expect(options.professionals.map((item) => item.id)).toEqual([PROFESSIONAL_ID])
    expect(options.initialProfessionalId).toBeNull()
  })

  it('starts today when the current day is out of reach', () => {
    const options = rescheduleOptions(
      { ...demoBusiness, max_advance_days: 1 },
      linkAppointment(),
      TODAY,
    )

    expect(options.days).toEqual(['2026-11-10', '2026-11-11'])
    expect(options.initialDay).toBe(TODAY)
  })

  it('has no service nor professionals once the service left the public page', () => {
    const options = rescheduleOptions({ ...demoBusiness, services: [] }, linkAppointment(), TODAY)

    expect(options.service).toBeNull()
    expect(options.professionals).toEqual([])
    expect(options.initialProfessionalId).toBeNull()
  })
})

describe('isFinalRefusal', () => {
  it.each([
    [apiError(404, 'NOT_FOUND'), true],
    [apiError(409, 'CHANGE_DEADLINE_PASSED'), true],
    [apiError(409, 'INVALID_STATUS_TRANSITION'), true],
    [apiError(409, 'SLOT_UNAVAILABLE'), false],
    [apiError(429, 'RATE_LIMITED'), false],
    [apiError(503, null), false],
    [new NetworkError(new TypeError('offline')), false],
    [new Error('other'), false],
  ])('%s → %s', (error, expected) => {
    expect(isFinalRefusal(error)).toBe(expected)
  })
})
