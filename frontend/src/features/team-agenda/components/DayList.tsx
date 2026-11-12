import { ChevronDownIcon } from 'lucide-react'
import { Fragment } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { formatTime, parseInstant } from '@/lib/datetime'

import type { StaffAppointment } from '../queries'
import { AppointmentCard } from './AppointmentCard'

interface DayListProps {
  /** The appointments of the day that take time (not cancelled), in order. */
  appointments: StaffAppointment[]
  timeZone: string
  now: Date
  isToday: boolean
  professionalOf: (appointment: StaffAppointment) => string | null
  describe: (appointment: StaffAppointment) => string
  onOpen: (appointment: StaffAppointment) => void
}

/**
 * The day on the phone (D80): one chronological list. On today, a "now" line
 * splits what already started from what is to come.
 */
export function DayList({
  appointments,
  timeZone,
  now,
  isToday,
  professionalOf,
  describe,
  onOpen,
}: DayListProps) {
  const nowMs = now.getTime()
  const nextIndex = isToday
    ? appointments.findIndex((item) => parseInstant(item.starts_at).getTime() > nowMs)
    : -1
  const lineAt = isToday ? (nextIndex === -1 ? appointments.length : nextIndex) : -1

  return (
    <ol className="flex flex-col gap-2.5" aria-label="Agendamentos do dia">
      {appointments.map((appointment, index) => (
        <Fragment key={appointment.id}>
          {index === lineAt ? <NowLine time={formatTime(now, timeZone)} /> : null}
          <li>
            <AppointmentCard
              appointment={appointment}
              timeZone={timeZone}
              professional={professionalOf(appointment)}
              awaitsResult={
                appointment.status === 'confirmed' && parseInstant(appointment.starts_at).getTime() <= nowMs
              }
              label={describe(appointment)}
              onOpen={onOpen}
            />
          </li>
        </Fragment>
      ))}
      {lineAt === appointments.length && appointments.length > 0 ? (
        <NowLine time={formatTime(now, timeZone)} />
      ) : null}
    </ol>
  )
}

function NowLine({ time }: { time: string }) {
  return (
    <li className="flex items-center gap-2 py-0.5" aria-label={`Agora, ${time}`}>
      <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
        {time}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-primary" />
    </li>
  )
}

interface CancelledGroupProps {
  appointments: StaffAppointment[]
  timeZone: string
  professionalOf: (appointment: StaffAppointment) => string | null
  describe: (appointment: StaffAppointment) => string
  onOpen: (appointment: StaffAppointment) => void
}

/** The cancelled of the day take no time (RN15): at the end, closed by default. */
export function CancelledGroup({
  appointments,
  timeZone,
  professionalOf,
  describe,
  onOpen,
}: CancelledGroupProps) {
  if (appointments.length === 0) return null
  return (
    <Collapsible className="flex flex-col gap-2.5">
      <CollapsibleTrigger className="group flex min-h-11 items-center gap-2 self-start rounded-lg px-1 text-[0.9375rem] font-medium text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground">
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 transition-transform duration-(--duration-fast) group-data-[state=open]:rotate-180"
        />
        Cancelados ({appointments.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col gap-2.5" aria-label="Cancelados do dia">
          {appointments.map((appointment) => (
            <li key={appointment.id}>
              <AppointmentCard
                appointment={appointment}
                timeZone={timeZone}
                professional={professionalOf(appointment)}
                awaitsResult={false}
                label={describe(appointment)}
                onOpen={onOpen}
              />
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
