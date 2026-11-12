import type { ReactNode } from 'react'

import { formatLocalDate, formatTimeRange, toLocalDate } from '@/lib/datetime'
import { formatDuration, formatPrice } from '@/lib/format'

import type { CustomerAppointment } from '../queries'

/** Service, professional, day and time, in the time zone of the business (D56). */
export function AppointmentDetails({ appointment }: { appointment: CustomerAppointment }) {
  const timeZone = appointment.business.timezone
  const { service } = appointment
  return (
    <dl className="grid gap-x-6 gap-y-4 rounded-xl border bg-card p-5 shadow-xs sm:grid-cols-2">
      <Item term="Serviço">
        {service.name}
        <span className="block text-sm font-normal text-muted-foreground tabular-nums">
          {formatDuration(service.duration_minutes)} · {formatPrice(service.price_cents)}
        </span>
      </Item>
      <Item term="Profissional">{appointment.professional.name}</Item>
      <Item term="Dia">
        <span className="inline-block first-letter:uppercase">
          {formatLocalDate(toLocalDate(appointment.starts_at, timeZone))}
        </span>
      </Item>
      <Item term="Horário">
        <span className="tabular-nums">
          {formatTimeRange(appointment.starts_at, appointment.ends_at, timeZone)}
        </span>
      </Item>
    </dl>
  )
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}
