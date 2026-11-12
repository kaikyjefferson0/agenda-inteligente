import type { PublicBusiness, PublicProfessional, PublicService } from './queries'

/** Value of the "any professional" choice (RN10), also used in the URL (D65). */
export const ANY_PROFESSIONAL = 'qualquer'

/** Only the professionals the business lists as bookable (RN07). */
export function professionalsOf(
  business: PublicBusiness,
  service: PublicService,
): PublicProfessional[] {
  return business.professionals.filter((professional) =>
    service.professional_ids.includes(professional.id),
  )
}

export function isBookable(business: PublicBusiness, service: PublicService): boolean {
  return professionalsOf(business, service).length > 0
}
