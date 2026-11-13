import { ApiError } from '@/api/errors'
import type { components } from '@/api/schema'

/** The format of `appointments_outside_hours` and of `conflicts` (docs/07-api.md). */
export type ScheduledAppointment = components['schemas']['AppointmentData']

const STATUSES = new Set(['confirmed', 'cancelled', 'completed', 'no_show'])

function isScheduledAppointment(value: unknown): value is ScheduledAppointment {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    ['id', 'professional_id', 'service_id', 'starts_at', 'ends_at', 'blocked_until', 'customer_name'].every(
      (key) => typeof item[key] === 'string',
    ) && STATUSES.has(item.status as string)
  )
}

/**
 * The appointments of a `409 APPOINTMENT_CONFLICTS`: a block over
 * appointments (RN21) or a deactivation with future ones (RN23). The OpenAPI
 * of `POST /time-blocks` and of `POST /professionals/{id}/deactivate` does not
 * list this `409`, so `schema.d.ts` has no type for it: the body is checked
 * here, in the format of `AppointmentData` (D86, D89). `null` for any other
 * error, or a body without the list.
 */
export function conflictsOf(error: unknown): ScheduledAppointment[] | null {
  if (!(error instanceof ApiError) || error.code !== 'APPOINTMENT_CONFLICTS') return null
  const list = (error.body as Record<string, unknown> | null)?.conflicts
  return Array.isArray(list) && list.every(isScheduledAppointment) ? list : null
}
