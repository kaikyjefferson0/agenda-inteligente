import type { Professional } from '@/features/scheduling'

/**
 * Where each one of the team stands (D91). The record of the Owner is never
 * deactivated: "Deixar de atender" only takes it out of the bookings, and
 * "Também atendo" brings it back (RN23).
 */
export type Situation = 'active' | 'pending' | 'deactivated' | 'owner-serving' | 'owner-not-serving'

export function situationOf(professional: Professional, ownerUserId: string): Situation {
  if (professional.user_id === ownerUserId) return professional.is_bookable ? 'owner-serving' : 'owner-not-serving'
  if (!professional.is_active) return 'deactivated'
  if (professional.invitation_pending) return 'pending'
  return 'active'
}

export const SITUATION_LABELS: Record<Situation, string> = {
  active: 'Ativo',
  pending: 'Convite pendente',
  deactivated: 'Desativado',
  'owner-serving': 'Atende',
  'owner-not-serving': 'Não atende',
}

const ORDER: Record<Situation, number> = {
  'owner-serving': 0,
  'owner-not-serving': 0,
  active: 1,
  pending: 2,
  deactivated: 3,
}

/** The Owner first, then the active ones, the pending invites and, last, who left. */
export function teamOrder(ownerUserId: string) {
  return (a: Professional, b: Professional) =>
    ORDER[situationOf(a, ownerUserId)] - ORDER[situationOf(b, ownerUserId)] ||
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type InviteField = 'name' | 'email'

/** What the API would refuse in the invite (1 to 120 characters, a valid e-mail), before sending. */
export function inviteProblems(name: string, email: string): Partial<Record<InviteField, string>> {
  const problems: Partial<Record<InviteField, string>> = {}
  const trimmed = name.trim()
  if (trimmed === '') problems.name = 'Informe o nome do profissional.'
  else if ([...trimmed].length > 120) problems.name = 'Use até 120 caracteres.'
  const address = email.trim()
  if (address === '') problems.email = 'Informe o e-mail para onde vai o convite.'
  else if (!EMAIL.test(address) || address.length > 254) problems.email = 'Confira o e-mail, como nome@exemplo.com.'
  return problems
}
