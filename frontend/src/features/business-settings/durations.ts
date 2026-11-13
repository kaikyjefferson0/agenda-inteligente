/**
 * A number of minutes as a number and a unit, as the Owner thinks of the
 * advance and of the deadline (D92). The API keeps minutes.
 */
export type TimeUnit = 'minutes' | 'hours' | 'days'

export const UNIT_MINUTES: Record<TimeUnit, number> = { minutes: 1, hours: 60, days: 1440 }

export const UNIT_LABELS: Record<TimeUnit, { one: string; many: string }> = {
  minutes: { one: 'minuto', many: 'minutos' },
  hours: { one: 'hora', many: 'horas' },
  days: { one: 'dia', many: 'dias' },
}

export interface Amount {
  amount: string
  unit: TimeUnit
}

/**
 * The largest unit that divides the value exactly: 1440 is "1 dia", 120 is
 * "2 horas", 90 stays "90 minutos". Zero is "0 minutos".
 */
export function splitMinutes(minutes: number): Amount {
  if (minutes > 0 && minutes % UNIT_MINUTES.days === 0) return { amount: String(minutes / 1440), unit: 'days' }
  if (minutes > 0 && minutes % UNIT_MINUTES.hours === 0) return { amount: String(minutes / 60), unit: 'hours' }
  return { amount: String(minutes), unit: 'minutes' }
}

/** Minutes of a typed amount, or `null` when it is not a whole number. */
export function toMinutes({ amount, unit }: Amount): number | null {
  const value = amount.trim()
  if (!/^\d+$/.test(value)) return null
  return Number(value) * UNIT_MINUTES[unit]
}

/** `1 dia`, `2 horas`, `90 minutos`: a value as the texts of the page say it. */
export function describeMinutes(minutes: number): string {
  const { amount, unit } = splitMinutes(minutes)
  const label = UNIT_LABELS[unit]
  return `${amount} ${amount === '1' ? label.one : label.many}`
}
