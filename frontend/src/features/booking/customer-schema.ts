import { z } from 'zod'

/**
 * Customer data of the public page (RN12), with texts in Portuguese: the
 * messages of the API come from Pydantic, in English (D53).
 */

const E164 = /^\+[1-9]\d{7,14}$/
const CONTROL = /\p{Cc}/u

/**
 * What the customer typed, in E.164 (D63). Without `+`, the number is
 * Brazilian: area code plus number, with or without the leading 0 or 55.
 * Returns `null` when it cannot be a phone number.
 */
export function toE164(raw: string): string | null {
  const trimmed = raw.trim()
  let digits = trimmed.replace(/\D/g, '')
  let candidate: string
  if (trimmed.startsWith('+')) {
    candidate = `+${digits}`
  } else {
    digits = digits.replace(/^0+/, '')
    if (digits.length === 10 || digits.length === 11) {
      candidate = `+55${digits}`
    } else if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
      candidate = `+${digits}`
    } else {
      return null
    }
  }
  return E164.test(candidate) ? candidate : null
}

export const FIELD_MESSAGES = {
  nameRequired: 'Informe seu nome.',
  nameTooLong: 'Use no máximo 120 caracteres no nome.',
  nameInvalid: 'O nome tem caracteres que não podem ser usados.',
  emailRequired: 'Informe seu e-mail.',
  emailInvalid: 'Informe um e-mail válido, como nome@exemplo.com.',
  phoneRequired: 'Informe seu telefone.',
  phoneInvalid: 'Informe o telefone com DDD, como (11) 98765-4321.',
} as const

export const customerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, FIELD_MESSAGES.nameRequired)
    .max(120, FIELD_MESSAGES.nameTooLong)
    .refine((value) => !CONTROL.test(value), FIELD_MESSAGES.nameInvalid),
  email: z
    .string()
    .trim()
    .min(1, FIELD_MESSAGES.emailRequired)
    .pipe(z.email(FIELD_MESSAGES.emailInvalid)),
  phone: z
    .string()
    .trim()
    .min(1, FIELD_MESSAGES.phoneRequired)
    .refine((value) => toE164(value) !== null, FIELD_MESSAGES.phoneInvalid),
})

export type CustomerInput = z.input<typeof customerSchema>
export type CustomerValues = z.output<typeof customerSchema>

export const EMPTY_CUSTOMER: CustomerInput = { name: '', email: '', phone: '' }

/** The field of the form for an item of `fieldErrors` from a `422`. */
export function customerFieldOf(field: string): keyof CustomerInput | null {
  if (field === 'customer.name') return 'name'
  if (field === 'customer.email') return 'email'
  if (field === 'customer.phone') return 'phone'
  return null
}

/** Our own text for a field the API refused. */
export const SERVER_FIELD_MESSAGES: Record<keyof CustomerInput, string> = {
  name: FIELD_MESSAGES.nameInvalid,
  email: FIELD_MESSAGES.emailInvalid,
  phone: FIELD_MESSAGES.phoneInvalid,
}
