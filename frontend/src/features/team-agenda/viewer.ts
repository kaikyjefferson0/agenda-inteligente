import { ownProfessional as ownProfessionalOf } from '@/features/scheduling'

import type { Professional, Service, StaffAppointment } from './queries'

/**
 * Who looks at the agenda (D74, D79). The page reads `GET /auth/me` and passes
 * it down, since a feature never imports from another (D66).
 */
export interface AgendaAccount {
  userId: string
  isOwner: boolean
  /** IANA time zone of the business (D56). */
  timeZone: string
}

/** The professional record of the person in the panel, if they serve. */
export function ownProfessional(
  account: AgendaAccount,
  professionals: Professional[],
): Professional | null {
  return ownProfessionalOf(account.userId, professionals)
}

/** The active services the professional does (RN07), in the order of the catalog. */
export function servicesOf(professional: Professional, services: Service[]): Service[] {
  return services.filter(
    (service) => service.is_active && professional.service_ids.includes(service.id),
  )
}

/** Whether the professional can take a new appointment (RN07). */
export function canBook(professional: Professional, services: Service[]): boolean {
  return (
    professional.is_active && professional.is_bookable && servicesOf(professional, services).length > 0
  )
}

/**
 * Who the form offers: every professional who can book, for the Owner; the
 * own record, for a Professional (UC16).
 */
export function bookableProfessionals(
  account: AgendaAccount,
  professionals: Professional[],
  services: Service[],
): Professional[] {
  const candidates = account.isOwner
    ? professionals
    : professionals.filter((professional) => professional.user_id === account.userId)
  return candidates.filter((professional) => canBook(professional, services))
}

/** The filter of the Owner: the active professionals (UC15). */
export function filterOptions(professionals: Professional[]): Professional[] {
  return professionals.filter((professional) => professional.is_active)
}

/**
 * The columns of the day grid for "every professional": who serves, plus
 * anyone with an appointment on the day (such as one who stopped serving),
 * in the order of the team.
 */
export function dayColumns(
  professionals: Professional[],
  appointments: StaffAppointment[],
): Professional[] {
  const busy = new Set(appointments.map((appointment) => appointment.professional_id))
  return professionals.filter(
    (professional) =>
      (professional.is_active && professional.is_bookable) || busy.has(professional.id),
  )
}

export function nameOf(professionals: Professional[], id: string): string {
  return professionals.find((professional) => professional.id === id)?.name ?? 'Profissional'
}

/** `Ana Souza` → `AS`, for the blocks of the week with every professional. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words
  return letters.map((word) => word[0]?.toLocaleUpperCase('pt-BR') ?? '').join('')
}
