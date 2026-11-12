/**
 * Demo accounts (D44, D75). The password comes from `VITE_DEMO_PASSWORD`, set
 * at build time: like every `VITE_` variable, it goes into the JavaScript the
 * browser downloads, so it is public. That is acceptable because the demo is
 * public and locked by RN28; the demo password must never be the one of a
 * real account. Without the variable, the shortcut does not show.
 */

export const DEMO_EMAIL_DOMAIN = '@demo.example.com'

export interface DemoAccount {
  email: string
  label: string
  description: string
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: 'dono@demo.example.com',
    label: 'Entrar como Dono',
    description: 'Agenda, serviços, equipe, expediente, bloqueios e dados do negócio.',
  },
  {
    email: 'profissional@demo.example.com',
    label: 'Entrar como Profissional',
    description: 'A própria agenda, o expediente e os bloqueios.',
  },
]

/** Read on each call, so the tests can change it. */
export function demoPassword(): string | null {
  const value = import.meta.env.VITE_DEMO_PASSWORD
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** RN28: the demo accounts have no password recovery. */
export function isDemoEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)
}
