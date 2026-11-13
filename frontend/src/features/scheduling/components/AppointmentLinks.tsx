import { useQuery } from '@tanstack/react-query'
import { ChevronRightIcon } from 'lucide-react'
import { Link } from 'react-router'

import { PATHS } from '@/app/router'
import { formatLocalDate, formatTimeRange, parseInstant, toLocalDate } from '@/lib/datetime'

import type { ScheduledAppointment } from '../conflicts'
import { professionalsQuery, servicesQuery } from '../staff-queries'

interface AppointmentLinksProps {
  appointments: ScheduledAppointment[]
  timeZone: string
  /** The Owner opens the agenda filtered by the professional (D81). */
  filterByProfessional: boolean
  label: string
  /** A list over the whole team (a new time zone) names the professional of each one. */
  showProfessional?: boolean
}

/** The day of the appointment in the agenda: `/painel?dia=…`, with the filter of the Owner. */
function agendaHref(appointment: ScheduledAppointment, timeZone: string, filter: boolean): string {
  const search = new URLSearchParams({ dia: toLocalDate(appointment.starts_at, timeZone) })
  if (filter) search.set('profissional', appointment.professional_id)
  return `${PATHS.panel}?${search.toString()}`
}

/**
 * Appointments in the format of `conflicts` and `appointments_outside_hours`
 * (no e-mail or phone), in the clock of the business, each one a link to its
 * day in the agenda, where it is cancelled or rescheduled. The name of the
 * service comes from the catalog, already read by the panel.
 */
export function AppointmentLinks({
  appointments,
  timeZone,
  filterByProfessional,
  label,
  showProfessional = false,
}: AppointmentLinksProps) {
  const services = useQuery(servicesQuery)
  const professionals = useQuery({ ...professionalsQuery, enabled: showProfessional })
  const professionalName = (id: string) =>
    professionals.data?.find((professional) => professional.id === id)?.name ?? 'Profissional'
  const serviceName = (id: string) => services.data?.find((service) => service.id === id)?.name ?? 'Serviço'
  const ordered = [...appointments].sort(
    (a, b) => parseInstant(a.starts_at).getTime() - parseInstant(b.starts_at).getTime(),
  )

  return (
    <ul aria-label={label} className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
      {ordered.map((appointment) => {
        const day = formatLocalDate(toLocalDate(appointment.starts_at, timeZone))
        const hours = formatTimeRange(appointment.starts_at, appointment.ends_at, timeZone)
        const service = serviceName(appointment.service_id)
        const who = showProfessional ? `, com ${professionalName(appointment.professional_id)}` : ''
        return (
          <li key={appointment.id}>
            <Link
              to={agendaHref(appointment, timeZone, filterByProfessional)}
              aria-label={`${day}, ${hours}, ${service}, ${appointment.customer_name}${who}. Ver na agenda`}
              className="flex min-h-14 items-center gap-3 px-4 py-2.5 text-foreground no-underline transition-colors duration-(--duration-fast) hover:bg-muted/60"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm text-muted-foreground first-letter:uppercase">{day}</span>
                <span className="truncate">
                  <span className="font-semibold tabular-nums">{hours}</span> · {service} ·{' '}
                  {appointment.customer_name}
                </span>
                {showProfessional ? (
                  <span className="truncate text-sm text-muted-foreground">
                    com {professionalName(appointment.professional_id)}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary">
                <span className="hidden sm:inline">Ver na agenda</span>
                <ChevronRightIcon aria-hidden="true" className="size-4" />
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
