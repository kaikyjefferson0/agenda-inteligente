import { localMinutes, parseInstant } from '@/lib/datetime'

import type { StaffAppointment } from './queries'

/**
 * Where each appointment goes in the time grid (D80). Positions are minutes
 * of the local wall clock of the business (D56), so a block at 09:07 starts
 * exactly at 09:07, off the grid if it has to be (RN19). The length is the
 * real elapsed time, and the block stops at midnight.
 */

const DAY_MINUTES = 24 * 60
/** Hours always shown, from 08:00 to 20:00, so an empty day still has a shape. */
export const DEFAULT_HOURS = { from: 8, to: 20 } as const

export interface Placed {
  appointment: StaffAppointment
  /** Minutes since local midnight. */
  start: number
  /** End of the service, and end of the preparation (`blocked_until`, RN03). */
  end: number
  blockedEnd: number
  /** Side by side when blocks overlap: the lane of this one and how many share the group. */
  lane: number
  lanes: number
}

function elapsedMinutes(from: string, to: string): number {
  return (parseInstant(to).getTime() - parseInstant(from).getTime()) / 60_000
}

function spanOf(appointment: StaffAppointment, timeZone: string) {
  const start = localMinutes(appointment.starts_at, timeZone)
  return {
    start,
    end: Math.min(DAY_MINUTES, start + elapsedMinutes(appointment.starts_at, appointment.ends_at)),
    blockedEnd: Math.min(
      DAY_MINUTES,
      start + elapsedMinutes(appointment.starts_at, appointment.blocked_until),
    ),
  }
}

/** The hours of the grid: 08:00 to 20:00, widened to fit every block. */
export function hourRange(appointments: StaffAppointment[], timeZone: string) {
  let from: number = DEFAULT_HOURS.from
  let to: number = DEFAULT_HOURS.to
  for (const appointment of appointments) {
    const span = spanOf(appointment, timeZone)
    from = Math.min(from, Math.floor(span.start / 60))
    to = Math.max(to, Math.ceil(span.blockedEnd / 60))
  }
  return { from, to }
}

/**
 * The blocks of one column (one day of one professional, or one day of
 * everyone), in lanes. Two blocks overlap when their occupied time
 * (`[starts_at, blocked_until)`) does: a group of overlapping blocks shares the
 * width, each in the first lane free at its start.
 */
export function layoutColumn(appointments: StaffAppointment[], timeZone: string): Placed[] {
  const items = appointments
    .map((appointment) => ({ appointment, ...spanOf(appointment, timeZone), lane: 0, lanes: 1 }))
    .sort((a, b) => a.start - b.start || a.appointment.id.localeCompare(b.appointment.id))

  const placed: Placed[] = []
  let group: Placed[] = []
  let laneEnds: number[] = []
  let groupEnd = -1

  const closeGroup = () => {
    for (const item of group) item.lanes = laneEnds.length
    placed.push(...group)
    group = []
    laneEnds = []
  }

  for (const item of items) {
    if (item.start >= groupEnd) closeGroup()
    let lane = laneEnds.findIndex((end) => end <= item.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.blockedEnd)
    } else {
      laneEnds[lane] = item.blockedEnd
    }
    item.lane = lane
    group.push(item)
    groupEnd = Math.max(groupEnd, item.blockedEnd)
  }
  closeGroup()
  return placed
}
