import type { components } from '@/api/schema'

import { describeMinutes, splitMinutes, toMinutes, type TimeUnit } from './durations'

export type BusinessSettings = components['schemas']['BusinessData']
export type BusinessUpdate = components['schemas']['UpdateBusinessResponse']
export type BusinessChanges = components['schemas']['UpdateBusinessRequest']

/** RN01. */
export const SLOT_STEPS = [5, 10, 15, 20, 30, 60] as const

/** The limits of `PATCH /business` (docs/07-api.md). */
export const BUSINESS_LIMITS = {
  nameMax: 120,
  slugMin: 3,
  slugMax: 63,
  minAdvanceMax: 525_600,
  maxAdvanceMin: 1,
  maxAdvanceMax: 365,
  deadlineMax: 43_200,
} as const

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type SettingsField = 'name' | 'slug' | 'timezone' | 'step' | 'minAdvance' | 'maxAdvance' | 'deadline'
export const SETTINGS_FIELDS: SettingsField[] = ['name', 'slug', 'timezone', 'step', 'minAdvance', 'maxAdvance', 'deadline']

export interface SettingsDraft {
  name: string
  slug: string
  timezone: string
  step: number
  minAdvance: string
  minAdvanceUnit: TimeUnit
  maxAdvance: string
  deadline: string
  deadlineUnit: TimeUnit
}

export type SettingsProblems = Partial<Record<SettingsField, string>>

export function draftOf(settings: BusinessSettings): SettingsDraft {
  const min = splitMinutes(settings.min_advance_minutes)
  const deadline = splitMinutes(settings.change_deadline_minutes)
  return {
    name: settings.name,
    slug: settings.slug,
    timezone: settings.timezone,
    step: settings.slot_step_minutes,
    minAdvance: min.amount,
    minAdvanceUnit: min.unit,
    maxAdvance: String(settings.max_advance_days),
    deadline: deadline.amount,
    deadlineUnit: deadline.unit,
  }
}

/**
 * What the slug field keeps while typing: lowercase, and a space becomes a
 * hyphen, as in the address. Accents and other signs stay, so the field says
 * what is wrong instead of changing them in silence.
 */
export function normalizeSlug(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-')
}

const length = (text: string) => [...text].length

/** What the API would refuse, told on each field before sending (UC05, RN05). */
export function problemsOf(draft: SettingsDraft): SettingsProblems {
  const problems: SettingsProblems = {}
  const name = draft.name.trim()
  if (name === '') problems.name = 'Informe o nome do negócio.'
  else if (length(name) > BUSINESS_LIMITS.nameMax) problems.name = `Use até ${BUSINESS_LIMITS.nameMax} caracteres.`

  const slug = draft.slug
  if (slug.length < BUSINESS_LIMITS.slugMin || slug.length > BUSINESS_LIMITS.slugMax) {
    problems.slug = `Use de ${BUSINESS_LIMITS.slugMin} a ${BUSINESS_LIMITS.slugMax} caracteres.`
  } else if (!SLUG.test(slug)) {
    problems.slug = 'Use só letras minúsculas sem acento, números e hifens, sem hífen no começo, no fim ou dois seguidos.'
  }

  if (draft.timezone === '') problems.timezone = 'Escolha o fuso do negócio.'
  if (!(SLOT_STEPS as readonly number[]).includes(draft.step)) problems.step = 'Escolha um dos passos da grade.'

  const maxDays = /^\d+$/.test(draft.maxAdvance.trim()) ? Number(draft.maxAdvance.trim()) : null
  const maxValid =
    maxDays !== null && maxDays >= BUSINESS_LIMITS.maxAdvanceMin && maxDays <= BUSINESS_LIMITS.maxAdvanceMax
  if (draft.maxAdvance.trim() === '') problems.maxAdvance = 'Informe até quantos dias à frente o cliente pode agendar.'
  else if (maxDays === null) problems.maxAdvance = 'Use um número inteiro de dias.'
  else if (!maxValid) problems.maxAdvance = 'Use de 1 a 365 dias.'

  const min = toMinutes({ amount: draft.minAdvance, unit: draft.minAdvanceUnit })
  if (draft.minAdvance.trim() === '') problems.minAdvance = 'Informe a antecedência mínima, ou 0.'
  else if (min === null) problems.minAdvance = 'Use um número inteiro.'
  else if (min > BUSINESS_LIMITS.minAdvanceMax) problems.minAdvance = 'A antecedência mínima vai até 365 dias.'
  else if (maxValid && min > maxDays * 1440) {
    problems.minAdvance = `A antecedência mínima não pode passar da máxima (${describeMinutes(maxDays * 1440)}).`
  }

  const deadline = toMinutes({ amount: draft.deadline, unit: draft.deadlineUnit })
  if (draft.deadline.trim() === '') problems.deadline = 'Informe o prazo, ou 0 para permitir até o início.'
  else if (deadline === null) problems.deadline = 'Use um número inteiro.'
  else if (deadline > BUSINESS_LIMITS.deadlineMax) problems.deadline = 'O prazo vai até 30 dias.'

  return problems
}

/**
 * Only what changed goes in the `PATCH`. On the demo, the name and the slug
 * are refused only when they change (RN28), so the rest still saves.
 */
export function changesOf(settings: BusinessSettings, draft: SettingsDraft): BusinessChanges {
  const changes: BusinessChanges = {}
  const name = draft.name.trim()
  if (name !== settings.name) changes.name = name
  if (draft.slug !== settings.slug) changes.slug = draft.slug
  if (draft.timezone !== settings.timezone) changes.timezone = draft.timezone
  if (draft.step !== settings.slot_step_minutes) {
    changes.slot_step_minutes = draft.step as NonNullable<BusinessChanges['slot_step_minutes']>
  }
  const min = toMinutes({ amount: draft.minAdvance, unit: draft.minAdvanceUnit })
  if (min !== null && min !== settings.min_advance_minutes) changes.min_advance_minutes = min
  const max = Number(draft.maxAdvance.trim())
  if (max !== settings.max_advance_days) changes.max_advance_days = max
  const deadline = toMinutes({ amount: draft.deadline, unit: draft.deadlineUnit })
  if (deadline !== null && deadline !== settings.change_deadline_minutes) changes.change_deadline_minutes = deadline
  return changes
}

/** A `422` of the API names the field as in the body; the form shows its own text. */
export const SERVER_FIELDS: Record<string, SettingsField> = {
  name: 'name',
  slug: 'slug',
  timezone: 'timezone',
  slot_step_minutes: 'step',
  min_advance_minutes: 'minAdvance',
  max_advance_days: 'maxAdvance',
  change_deadline_minutes: 'deadline',
}

export const SERVER_TEXTS: Record<SettingsField, string> = {
  name: `Use de 1 a ${BUSINESS_LIMITS.nameMax} caracteres.`,
  slug: 'Use de 3 a 63 letras minúsculas, números e hifens.',
  timezone: 'A API não reconhece este fuso. Escolha outro da lista.',
  step: 'Escolha um dos passos da grade.',
  minAdvance: 'A antecedência mínima vai de 0 a 365 dias e não pode passar da máxima.',
  maxAdvance: 'Use de 1 a 365 dias.',
  deadline: 'O prazo vai de 0 a 30 dias.',
}
