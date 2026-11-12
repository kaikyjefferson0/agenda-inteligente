import { useQuery } from '@tanstack/react-query'

import { isLocalDate, localMinutes, toLocalDate } from '@/lib/datetime'

import { weekStartOf } from './period'
import { agendaQuery, timeBlocksQuery, workingHoursQuery } from './queries'
import { busyRangesOf, freeRanges, workingRangesOf, type Range } from './slot-check'

interface SlotContextParams {
  professionalId: string
  day: string
  timeZone: string
  now: Date
  /** Service plus preparation (RN03). */
  blockMinutes: number
  /** The appointment being rescheduled, which may overlap its own time (D30). */
  exceptId?: string
}

export interface SlotContext {
  /** `undefined` while loading or after an error. */
  working: Range[] | undefined
  free: Range[] | undefined
  loading: boolean
  error: unknown
  retry: () => void
}

/**
 * What the form needs to help choosing a time (D82): the working hours of
 * the professional, read only when the form opens, plus the agenda of that
 * week and the blocks, for the free ranges. Without a professional or a valid
 * day, nothing is read.
 */
export function useSlotContext({
  professionalId,
  day,
  timeZone,
  now,
  blockMinutes,
  exceptId,
}: SlotContextParams): SlotContext {
  const enabled = professionalId !== '' && isLocalDate(day)
  const week = enabled ? weekStartOf(day) : ''
  const hours = useQuery({ ...workingHoursQuery(professionalId), enabled })
  const blocks = useQuery({ ...timeBlocksQuery(professionalId), enabled })
  // Without a professional in the filter: everyone for the Owner, the own agenda otherwise.
  const agenda = useQuery({ ...agendaQuery(week, null, timeZone), enabled })

  const working = enabled && hours.data !== undefined ? workingRangesOf(hours.data.intervals, day) : undefined

  let free: Range[] | undefined
  if (working !== undefined && blocks.data !== undefined && agenda.data !== undefined) {
    const today = toLocalDate(now, timeZone)
    // Today, from the next minute on; a past day has nothing left.
    const notBefore = day === today ? localMinutes(now, timeZone) + 1 : day < today ? 24 * 60 : null
    free = freeRanges(
      working,
      busyRangesOf(professionalId, agenda.data, blocks.data, day, timeZone, exceptId),
      blockMinutes,
      notBefore,
    )
  }

  return {
    working,
    free,
    loading: enabled && (hours.isPending || blocks.isPending || agenda.isPending),
    error: hours.error ?? blocks.error ?? agenda.error,
    retry: () => {
      if (hours.isError) void hours.refetch()
      if (blocks.isError) void blocks.refetch()
      if (agenda.isError) void agenda.refetch()
    },
  }
}
