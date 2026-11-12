import type { components } from '@/api/schema'

export type AppointmentStatus = components['schemas']['AppointmentStatus']

/** The status in words (D55): the badge and the screen-reader name of a block use the same. */
export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  confirmed: 'Confirmado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
}
