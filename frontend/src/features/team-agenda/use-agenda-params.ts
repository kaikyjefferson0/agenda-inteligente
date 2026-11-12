import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

import { isLocalDate } from '@/lib/datetime'

export type AgendaView = 'dia' | 'semana'

export interface AgendaParams {
  day: string
  view: AgendaView
  /** The id in `?profissional=`, not yet checked against the team. */
  professionalId: string | null
}

/**
 * The agenda state in the URL (D81): `?dia=AAAA-MM-DD`, `?visao=semana` and
 * `?profissional=<id>`, so a reload or a shared link opens the same agenda.
 * Every change replaces the entry of the history: going through the days is
 * browsing, not steps to come back to. An invalid value is ignored.
 */
export function useAgendaParams(today: string) {
  const [search, setSearch] = useSearchParams()

  const rawDay = search.get('dia')
  const params: AgendaParams = {
    day: rawDay !== null && isLocalDate(rawDay) ? rawDay : today,
    view: search.get('visao') === 'semana' ? 'semana' : 'dia',
    professionalId: search.get('profissional') || null,
  }

  const update = useCallback(
    (change: Partial<AgendaParams>) => {
      setSearch(
        (current) => {
          const next = new URLSearchParams(current)
          const set = (key: string, value: string | null) => {
            if (value === null) next.delete(key)
            else next.set(key, value)
          }
          if (change.day !== undefined) set('dia', change.day === today ? null : change.day)
          if (change.view !== undefined) set('visao', change.view === 'semana' ? 'semana' : null)
          if (change.professionalId !== undefined) set('profissional', change.professionalId)
          return next
        },
        { replace: true },
      )
    },
    [setSearch, today],
  )

  return [params, update] as const
}
