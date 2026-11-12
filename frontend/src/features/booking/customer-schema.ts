import { z } from 'zod'

import {
  CUSTOMER_MESSAGES,
  customerEmail,
  customerName,
  customerPhone,
} from '@/features/scheduling'

/**
 * Customer data of the public page (RN12): the three fields are required. The
 * rules are the shared ones of `scheduling` (D66); the "required" texts speak
 * to the customer.
 */

export const FIELD_MESSAGES = {
  ...CUSTOMER_MESSAGES,
  nameRequired: 'Informe seu nome.',
  emailRequired: 'Informe seu e-mail.',
  phoneRequired: 'Informe seu telefone.',
} as const

export const customerSchema = z.object({
  name: customerName(FIELD_MESSAGES.nameRequired),
  email: customerEmail(FIELD_MESSAGES.emailRequired),
  phone: customerPhone(FIELD_MESSAGES.phoneRequired),
})

export type CustomerInput = z.input<typeof customerSchema>
export type CustomerValues = z.output<typeof customerSchema>

export const EMPTY_CUSTOMER: CustomerInput = { name: '', email: '', phone: '' }
