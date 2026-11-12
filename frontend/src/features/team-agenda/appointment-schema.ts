import { z } from 'zod'

import { customerName, optionalEmail, optionalPhone } from '@/features/scheduling'
import { isLocalDate, parseLocalTime } from '@/lib/datetime'

/**
 * The manual appointment (UC16, RN19): only the name of the customer is
 * required; e-mail and phone are optional and follow the rules of the public
 * page (D9). The time is any exact minute, off the grid. Whether it is past or
 * out of the working hours is checked against the agenda (`slot-check.ts`).
 */

export const APPOINTMENT_MESSAGES = {
  professional: 'Escolha o profissional.',
  service: 'Escolha o serviço.',
  day: 'Escolha o dia.',
  time: 'Informe a hora, como 09:30.',
  name: 'Informe o nome do cliente.',
} as const

export const appointmentSchema = z.object({
  professionalId: z.string().min(1, APPOINTMENT_MESSAGES.professional),
  serviceId: z.string().min(1, APPOINTMENT_MESSAGES.service),
  day: z.string().refine(isLocalDate, APPOINTMENT_MESSAGES.day),
  time: z.string().refine((value) => parseLocalTime(value) !== null, APPOINTMENT_MESSAGES.time),
  name: customerName(APPOINTMENT_MESSAGES.name),
  email: optionalEmail(),
  phone: optionalPhone(),
})

export type AppointmentInput = z.input<typeof appointmentSchema>
export type AppointmentValues = z.output<typeof appointmentSchema>
