import type { components } from '@/api/schema'

export type Service = components['schemas']['ServiceData']
export type CreateServiceBody = components['schemas']['CreateServiceRequest']
export type UpdateServiceBody = components['schemas']['UpdateServiceRequest']

/** The limits of `POST` and `PATCH /services` (docs/07-api.md). */
export const SERVICE_LIMITS = {
  nameMax: 120,
  durationMin: 1,
  durationMax: 1440,
  preparationMax: 1440,
  priceMaxCents: 100_000_000,
} as const

export type ServiceField = 'name' | 'duration' | 'preparation' | 'price'
export const SERVICE_FIELDS: ServiceField[] = ['name', 'duration', 'preparation', 'price']

/** What is typed in the form: the price in reais, as text (D63). */
export interface ServiceDraft {
  name: string
  duration: string
  preparation: string
  price: string
}

export type ServiceProblems = Partial<Record<ServiceField, string>>

const MONEY = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `5000` → `50,00`; `123456` → `1.234,56`. What the price field shows. */
export function priceText(cents: number): string {
  return MONEY.format(cents / 100)
}

export type PriceParse = { ok: true; cents: number } | { ok: false; reason: 'empty' | 'format' | 'max' }

/**
 * A price typed in reais, in cents, with integer math only (no `float`
 * rounding). Accepts `50`, `50,5`, `1.234,56`, `R$ 50` and also `50.50`
 * (a point with one or two decimals is the decimal separator; with three,
 * it groups thousands, as in `1.234`).
 */
export function parsePrice(text: string): PriceParse {
  const value = text.replace(/R\$/i, '').replace(/\s/g, '')
  if (value === '') return { ok: false, reason: 'empty' }

  let whole: string
  let fraction = ''
  if (value.includes(',')) {
    const match = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/.exec(value)
    if (match === null) return { ok: false, reason: 'format' }
    whole = match[1].replaceAll('.', '')
    fraction = match[2]
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) {
    whole = value.replaceAll('.', '')
  } else {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value)
    if (match === null) return { ok: false, reason: 'format' }
    whole = match[1]
    fraction = match[2] ?? ''
  }

  // Too many digits would lose precision before the limit check.
  if (whole.replace(/^0+/, '').length > 9) return { ok: false, reason: 'max' }
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (cents > SERVICE_LIMITS.priceMaxCents) return { ok: false, reason: 'max' }
  return { ok: true, cents }
}

export function draftOf(service?: Service): ServiceDraft {
  if (service === undefined) return { name: '', duration: '', preparation: '0', price: '' }
  return {
    name: service.name,
    duration: String(service.duration_minutes),
    preparation: String(service.preparation_minutes),
    price: priceText(service.price_cents),
  }
}

/** The name is counted in characters, as the API does, and not in UTF-16 units. */
const length = (text: string) => [...text].length

function minutesProblem(text: string, min: number, max: number, what: 'duration' | 'preparation'): string | undefined {
  const value = text.trim()
  if (value === '') {
    return what === 'duration' ? 'Informe a duração, em minutos.' : 'Informe o preparo, em minutos, ou 0.'
  }
  if (!/^\d+$/.test(value)) return 'Use um número inteiro de minutos, sem vírgula.'
  const minutes = Number(value)
  if (minutes < min || minutes > max) {
    return what === 'duration'
      ? `A duração vai de ${min} a ${max} minutos (24 horas).`
      : `O preparo vai de ${min} a ${max} minutos (24 horas).`
  }
  return undefined
}

/** What the API would refuse, told on each field before sending (UC06). */
export function problemsOf(draft: ServiceDraft): ServiceProblems {
  const problems: ServiceProblems = {}
  const name = draft.name.trim()
  if (name === '') problems.name = 'Informe o nome do serviço.'
  else if (length(name) > SERVICE_LIMITS.nameMax) problems.name = `Use até ${SERVICE_LIMITS.nameMax} caracteres.`

  const duration = minutesProblem(draft.duration, SERVICE_LIMITS.durationMin, SERVICE_LIMITS.durationMax, 'duration')
  if (duration !== undefined) problems.duration = duration
  const preparation = minutesProblem(draft.preparation, 0, SERVICE_LIMITS.preparationMax, 'preparation')
  if (preparation !== undefined) problems.preparation = preparation

  const price = parsePrice(draft.price)
  if (!price.ok) {
    problems.price = {
      empty: 'Informe o preço, como 50,00. Use 0 para um serviço gratuito.',
      format: 'Use só números, como 50, 49,90 ou 1.234,56.',
      max: 'O preço vai até R$ 1.000.000,00.',
    }[price.reason]
  }
  return problems
}

/** The body of `POST /services`, from a draft without problems. */
export function bodyOf(draft: ServiceDraft): CreateServiceBody {
  const price = parsePrice(draft.price)
  if (!price.ok) throw new Error('The price was not checked before sending.')
  return {
    name: draft.name.trim(),
    duration_minutes: Number(draft.duration.trim()),
    preparation_minutes: Number(draft.preparation.trim()),
    price_cents: price.cents,
  }
}

/**
 * The `PATCH` changes only what is sent: only the fields that differ go. On
 * the demo, the name is refused only when it changes (RN28), so leaving it
 * out keeps the other changes working.
 */
export function changesOf(service: Service, body: CreateServiceBody): UpdateServiceBody {
  const changes: UpdateServiceBody = {}
  if (body.name !== service.name) changes.name = body.name
  if (body.duration_minutes !== service.duration_minutes) changes.duration_minutes = body.duration_minutes
  if (body.preparation_minutes !== service.preparation_minutes) {
    changes.preparation_minutes = body.preparation_minutes
  }
  if (body.price_cents !== service.price_cents) changes.price_cents = body.price_cents
  return changes
}

/** A `422` of the API names the field as in the body; the form shows its own text. */
export const SERVER_FIELDS: Record<string, ServiceField> = {
  name: 'name',
  duration_minutes: 'duration',
  preparation_minutes: 'preparation',
  price_cents: 'price',
}

/** Active first, then by name, as the people of the business read it. */
export function byName(a: Service, b: Service): number {
  return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
}
