import { problemOf } from '@/api/errors'
import type { components } from '@/api/schema'

/** The format of `appointments_outside_hours` and of `conflicts` (docs/07-api.md). */
export type ScheduledAppointment = components['schemas']['AppointmentData']

/**
 * The appointments of a `409 APPOINTMENT_CONFLICTS`: a block over
 * appointments (RN21) or a deactivation with future ones (RN23). Both routes
 * declare the body as `AppointmentConflictsProblem` (D94), so the list comes
 * typed from `schema.d.ts` (D97). `null` for any other error.
 */
export function conflictsOf(error: unknown): ScheduledAppointment[] | null {
  return problemOf(error, 'APPOINTMENT_CONFLICTS')?.conflicts ?? null
}
