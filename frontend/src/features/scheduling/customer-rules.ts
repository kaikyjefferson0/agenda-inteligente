import { z } from 'zod'

/**
 * Rules of the customer data (RN12, D9), shared by the public booking, where
 * the three fields are required, and the team agenda, where only the name is
 * (RN19). The texts are in Portuguese: the messages of the API come from
 * Pydantic, in English (D53). Each form gives its own "required" text, since
 * the customer reads "seu nome" and the team reads "nome do cliente".
 */

const E164 = /^\+[1-9]\d{7,14}$/
const CONTROL = /\p{Cc}/u

/**
 * What was typed, in E.164 (D63). Without `+`, the number is Brazilian: area
 * code plus number, with or without the leading 0 or 55. Returns `null` when
 * it cannot be a phone number.
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

/** The texts of a refused value, the same for the customer and for the team. */
export const CUSTOMER_MESSAGES = {
  nameTooLong: 'Use no máximo 120 caracteres no nome.',
  nameInvalid: 'O nome tem caracteres que não podem ser usados.',
  emailInvalid: 'Informe um e-mail válido, como nome@exemplo.com.',
  phoneInvalid: 'Informe o telefone com DDD, como (11) 98765-4321.',
} as const

/** The name: required, at most 120 characters and no control characters (as the API). */
export function customerName(required: string) {
  return z
    .string()
    .trim()
    .min(1, required)
    .max(120, CUSTOMER_MESSAGES.nameTooLong)
    .refine((value) => !CONTROL.test(value), CUSTOMER_MESSAGES.nameInvalid)
}

export function customerEmail(required: string) {
  return z.string().trim().min(1, required).pipe(z.email(CUSTOMER_MESSAGES.emailInvalid))
}

export function customerPhone(required: string) {
  return z
    .string()
    .trim()
    .min(1, required)
    .refine((value) => toE164(value) !== null, CUSTOMER_MESSAGES.phoneInvalid)
}

/** An optional e-mail: empty means none (`null` for the API). */
export function optionalEmail() {
  return z
    .string()
    .trim()
    .refine(
      (value) => value === '' || z.email().safeParse(value).success,
      CUSTOMER_MESSAGES.emailInvalid,
    )
    .transform((value) => (value === '' ? null : value))
}

/** An optional phone: empty means none, otherwise it goes in E.164 (D63). */
export function optionalPhone() {
  return z
    .string()
    .trim()
    .refine((value) => value === '' || toE164(value) !== null, CUSTOMER_MESSAGES.phoneInvalid)
    .transform((value) => (value === '' ? null : toE164(value)))
}

export type CustomerField = 'name' | 'email' | 'phone'

/** The field of a form for an item of `fieldErrors` from a `422`. */
export function customerFieldOf(field: string): CustomerField | null {
  if (field === 'customer.name') return 'name'
  if (field === 'customer.email') return 'email'
  if (field === 'customer.phone') return 'phone'
  return null
}

/** Our own text for a field the API refused. */
export const SERVER_FIELD_MESSAGES: Record<CustomerField, string> = {
  name: CUSTOMER_MESSAGES.nameInvalid,
  email: CUSTOMER_MESSAGES.emailInvalid,
  phone: CUSTOMER_MESSAGES.phoneInvalid,
}
