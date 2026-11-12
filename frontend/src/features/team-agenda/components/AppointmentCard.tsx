import { ChevronRightIcon, ClockAlertIcon } from 'lucide-react'

import { StatusBadge } from '@/features/scheduling'
import { formatTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'

import type { StaffAppointment } from '../queries'

interface AppointmentCardProps {
  appointment: StaffAppointment
  timeZone: string
  /** The professional, only when the Owner sees everyone. */
  professional: string | null
  /** Confirmed and already started: the result is waiting (UC18). */
  awaitsResult: boolean
  /** Name for screen readers: `09:00–09:30, Corte, Ana, Confirmado`, the same as the grid. */
  label: string
  onOpen: (appointment: StaffAppointment) => void
}

/**
 * One appointment of the day list (D80): the time large on the left, in
 * tabular numerals, for a quick read at the counter; the rest on the right.
 * The whole card opens the details, with at least 44 px of height.
 */
export function AppointmentCard({
  appointment,
  timeZone,
  professional,
  awaitsResult,
  label,
  onOpen,
}: AppointmentCardProps) {
  const start = formatTime(appointment.starts_at, timeZone)
  const end = formatTime(appointment.ends_at, timeZone)
  const final = appointment.status !== 'confirmed'

  return (
    <button
      type="button"
      aria-label={label}
      data-appointment-id={appointment.id}
      onClick={() => onOpen(appointment)}
      className={cn(
        'group flex w-full items-stretch gap-4 rounded-xl border bg-card p-3.5 text-left shadow-xs transition-[border-color,background-color] duration-(--duration-fast) hover:border-input',
        final && 'bg-card/60 shadow-none',
      )}
    >
      <span className="flex w-14 shrink-0 flex-col tabular-nums">
        <span className={cn('text-lg leading-tight font-semibold', final && 'text-muted-foreground')}>
          {start}
        </span>
        <span className="text-sm text-muted-foreground">{end}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-base leading-snug font-semibold">{appointment.service_name}</span>
        <span className="truncate text-[0.9375rem] text-foreground/90">{appointment.customer_name}</span>
        {professional !== null ? (
          <span className="truncate text-sm text-muted-foreground">com {professional}</span>
        ) : null}
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <StatusBadge status={appointment.status} />
          {awaitsResult ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-foreground">
              <ClockAlertIcon aria-hidden="true" className="size-4" />
              Registrar resultado
            </span>
          ) : null}
        </span>
      </span>
      <ChevronRightIcon
        aria-hidden="true"
        className="size-5 shrink-0 self-center text-muted-foreground transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
      />
    </button>
  )
}
