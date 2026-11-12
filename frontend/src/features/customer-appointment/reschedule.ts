import {
  professionalsOf,
  type PublicBusiness,
  type PublicProfessional,
  type PublicService,
} from '@/features/scheduling'
import { localDateRange, toLocalDate } from '@/lib/datetime'

import type { CustomerAppointment } from './queries'

/**
 * Rules of the reschedule on the customer link (UC14, D68). The link only
 * carries the appointment; the professionals and the reach of the calendar
 * come from the public page of the business, read on demand. The slots come
 * from the public availability as they are: it counts the appointment being
 * moved as busy for its own professional, just as the reschedule does, so a
 * slot over the current time is offered only with another professional.
 */

export interface RescheduleOptions {
  /** `null` when the service left the public page in the meantime. */
  service: PublicService | null
  /** Bookable professionals of the service (RN07). */
  professionals: PublicProfessional[]
  /** Starting choice: the current professional while still bookable, else any (RN10). */
  initialProfessionalId: string | null
  /** Days open for booking, from today in the business (RN05). */
  days: string[]
  /** The day of the current appointment while open for booking, else today. */
  initialDay: string
}

export function rescheduleOptions(
  business: PublicBusiness,
  appointment: CustomerAppointment,
  today: string,
): RescheduleOptions {
  const service = business.services.find((item) => item.id === appointment.service.id) ?? null
  const professionals = service === null ? [] : professionalsOf(business, service)
  const current = appointment.professional.id
  const initialProfessionalId = professionals.some((item) => item.id === current) ? current : null
  const days = localDateRange(today, business.max_advance_days + 1)
  const day = toLocalDate(appointment.starts_at, business.timezone)
  return {
    service,
    professionals,
    initialProfessionalId,
    days,
    initialDay: days.includes(day) ? day : today,
  }
}
