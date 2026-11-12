import { useCallback, useMemo, useState } from 'react'
import { createSearchParams, useLocation, useNavigate, useSearchParams } from 'react-router'

import { isLocalDate, localDateRange, toLocalDate } from '@/lib/datetime'

import type { PublicBusiness, PublicProfessional, PublicService } from './queries'

/**
 * State of the booking flow (D65). Service, professional and day live in the
 * URL, so the back button of the phone goes back one step; the chosen slot
 * lives in the history entry (`location.state`), and the customer data never
 * leaves memory. A parameter that does not fit the business is ignored, and
 * the flow starts at the first step still missing.
 */

export const SEARCH = { service: 'servico', professional: 'profissional', day: 'dia' } as const
/** Value of `profissional` for "any professional" (RN10). */
export const ANY_PROFESSIONAL = 'qualquer'

export type Step = 'service' | 'professional' | 'datetime' | 'customer'

export interface Selection {
  service: PublicService | null
  /** Bookable professionals of the chosen service. */
  professionals: PublicProfessional[]
  /** `undefined` while not chosen; `null` is "any professional". */
  professionalId: string | null | undefined
  /** Whether the professional step exists: more than one professional. */
  choosesProfessional: boolean
  /** Days open for booking, from today in the business (RN05). */
  days: string[]
  day: string
}

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

export function resolveSelection(
  business: PublicBusiness,
  search: URLSearchParams,
  today: string,
): Selection {
  const days = localDateRange(today, business.max_advance_days + 1)
  const dayParam = search.get(SEARCH.day)
  const day = dayParam !== null && isLocalDate(dayParam) && days.includes(dayParam) ? dayParam : today

  const serviceParam = search.get(SEARCH.service)
  const found = business.services.find((service) => service.id === serviceParam)
  const service = found !== undefined && isBookable(business, found) ? found : null
  const professionals = service === null ? [] : professionalsOf(business, service)
  const choosesProfessional = professionals.length > 1

  let professionalId: string | null | undefined
  if (service === null) {
    professionalId = undefined
  } else if (!choosesProfessional) {
    professionalId = professionals[0].id
  } else {
    const param = search.get(SEARCH.professional)
    if (param === ANY_PROFESSIONAL) professionalId = null
    else if (professionals.some((professional) => professional.id === param)) professionalId = param
    else professionalId = undefined
  }

  return { service, professionals, professionalId, choosesProfessional, days, day }
}

/** The steps shown in "Passo N de M". */
export function stepsOf(business: PublicBusiness, selection: Selection): Step[] {
  const choosesProfessional =
    selection.service === null
      ? business.services.some((service) => professionalsOf(business, service).length > 1)
      : selection.choosesProfessional
  return choosesProfessional
    ? ['service', 'professional', 'datetime', 'customer']
    : ['service', 'datetime', 'customer']
}

export function currentStep(selection: Selection, slotOffered: boolean): Step {
  if (selection.service === null) return 'service'
  if (selection.professionalId === undefined) return 'professional'
  return slotOffered ? 'customer' : 'datetime'
}

function slotFromState(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null
  const { slot } = state as { slot?: unknown }
  return typeof slot === 'string' ? slot : null
}

export function useBookingFlow(business: PublicBusiness) {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  // Today in the business, never in the browser (D56); fixed while the page is open.
  const [today] = useState(() => toLocalDate(new Date(), business.timezone))

  const selection = useMemo(
    () => resolveSelection(business, searchParams, today),
    [business, searchParams, today],
  )
  const slot = slotFromState(location.state)

  /** Search built only from valid choices, so an ignored parameter is dropped. */
  const searchFor = useCallback(
    (choice: { service: string; professional?: string | null; day?: string }) => {
      const params: Record<string, string> = { [SEARCH.service]: choice.service }
      if (choice.professional !== undefined) {
        params[SEARCH.professional] = choice.professional ?? ANY_PROFESSIONAL
      }
      if (choice.day !== undefined && choice.day !== today) params[SEARCH.day] = choice.day
      return `?${createSearchParams(params).toString()}`
    },
    [today],
  )

  const professionalParam = selection.choosesProfessional ? selection.professionalId : undefined

  const chooseService = useCallback(
    (serviceId: string) => navigate({ search: searchFor({ service: serviceId }) }),
    [navigate, searchFor],
  )

  const chooseProfessional = useCallback(
    (professionalId: string | null) => {
      if (selection.service === null) return
      navigate({
        search: searchFor({
          service: selection.service.id,
          professional: professionalId,
          day: selection.day,
        }),
      })
    },
    [navigate, searchFor, selection.service, selection.day],
  )

  /** Browsing the days replaces the entry: going back skips them all. */
  const chooseDay = useCallback(
    (day: string) => {
      if (selection.service === null) return
      navigate(
        { search: searchFor({ service: selection.service.id, professional: professionalParam, day }) },
        { replace: true },
      )
    },
    [navigate, searchFor, selection.service, professionalParam],
  )

  const chooseSlot = useCallback(
    (startsAt: string) => navigate({ search: location.search }, { state: { slot: startsAt } }),
    [navigate, location.search],
  )

  /** Back to the slots, replacing the entry of the customer step. */
  const clearSlot = useCallback(
    () => navigate({ search: location.search }, { replace: true, state: null }),
    [navigate, location.search],
  )

  const editService = useCallback(() => navigate({ search: '' }), [navigate])

  const editProfessional = useCallback(() => {
    if (selection.service === null) return
    navigate({ search: searchFor({ service: selection.service.id, day: selection.day }) })
  }, [navigate, searchFor, selection.service, selection.day])

  const startOver = useCallback(() => navigate({ search: '' }, { replace: true }), [navigate])

  return {
    today,
    selection,
    slot,
    chooseService,
    chooseProfessional,
    chooseDay,
    chooseSlot,
    clearSlot,
    editService,
    editProfessional,
    startOver,
  }
}
