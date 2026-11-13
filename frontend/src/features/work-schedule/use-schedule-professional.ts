import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

import { ownProfessional, professionalsQuery, type Professional } from '@/features/scheduling'

/**
 * Who opens the working hours or the blocks (D74). The page reads
 * `GET /auth/me` and passes it down, since a feature never imports from
 * another (D66).
 */
export interface ScheduleAccount {
  userId: string
  isOwner: boolean
  /** IANA time zone of the business (D56). */
  timeZone: string
}

/**
 * Whose schedule is on the screen. A Professional edits only the own one,
 * with no choice. The Owner picks among the active professionals, the Owner
 * included while serving (D43), in `?profissional=<id>` (as the agenda, D81):
 * an unknown id is ignored, and without one the Owner starts with the own
 * schedule, or the first of the team when not serving.
 */
export function useScheduleProfessional(account: ScheduleAccount) {
  const professionals = useQuery(professionalsQuery)
  const [search, setSearch] = useSearchParams()

  const team = professionals.data ?? []
  const own = ownProfessional(account.userId, team)
  const options = account.isOwner
    ? team.filter((professional) => professional.is_active && (professional.id !== own?.id || own.is_bookable))
    : []
  const wanted = search.get('profissional')

  let selected: Professional | null
  if (!account.isOwner) selected = own
  else {
    selected =
      options.find((professional) => professional.id === wanted) ??
      options.find((professional) => professional.id === own?.id) ??
      options[0] ??
      null
  }

  const select = useCallback(
    (id: string) =>
      setSearch(
        (current) => {
          const next = new URLSearchParams(current)
          next.set('profissional', id)
          return next
        },
        { replace: true },
      ),
    [setSearch],
  )

  return { query: professionals, options, own, selected, select }
}
