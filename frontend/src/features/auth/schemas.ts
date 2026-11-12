import { z } from 'zod'

/**
 * Forms of the account pages, with texts in Portuguese (D53). The new password
 * follows RN30: 12 to 128 characters, with no composition rules. The login
 * only asks for a password: RN30 applies when a password is defined.
 */

export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

export const AUTH_MESSAGES = {
  emailRequired: 'Informe seu e-mail.',
  emailInvalid: 'Informe um e-mail válido, como nome@exemplo.com.',
  passwordRequired: 'Informe sua senha.',
  newPasswordRequired: 'Crie uma senha.',
  passwordTooShort: `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`,
  passwordTooLong: `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`,
} as const

/** Characters as the API counts them (code points), not UTF-16 units. */
export function passwordLength(value: string): number {
  return Array.from(value).length
}

const email = z
  .string()
  .trim()
  .min(1, AUTH_MESSAGES.emailRequired)
  .pipe(z.email(AUTH_MESSAGES.emailInvalid))

export const loginSchema = z.object({
  email,
  // Never trimmed: spaces are part of a password.
  password: z
    .string()
    .min(1, AUTH_MESSAGES.passwordRequired)
    .refine((value) => passwordLength(value) <= PASSWORD_MAX, AUTH_MESSAGES.passwordTooLong),
})

export const forgotPasswordSchema = z.object({ email })

export const newPasswordSchema = z.object({
  password: z
    .string()
    .min(1, AUTH_MESSAGES.newPasswordRequired)
    .refine((value) => passwordLength(value) >= PASSWORD_MIN, AUTH_MESSAGES.passwordTooShort)
    .refine((value) => passwordLength(value) <= PASSWORD_MAX, AUTH_MESSAGES.passwordTooLong),
})

export type LoginValues = z.infer<typeof loginSchema>
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>
export type NewPasswordValues = z.infer<typeof newPasswordSchema>
