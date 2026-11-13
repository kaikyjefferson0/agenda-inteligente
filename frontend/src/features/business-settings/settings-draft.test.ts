import { describe, expect, it } from 'vitest'

import { describeMinutes, splitMinutes, toMinutes } from './durations'
import {
  changesOf,
  draftOf,
  normalizeSlug,
  problemsOf,
  type BusinessSettings,
  type SettingsDraft,
} from './settings-draft'
import { offsetOf, zoneGroups, zoneLabel } from './timezones'

const saved: BusinessSettings = {
  id: 'b1',
  name: 'Barbearia Central',
  slug: 'barbearia-central',
  timezone: 'America/Sao_Paulo',
  slot_step_minutes: 15,
  min_advance_minutes: 60,
  max_advance_days: 30,
  change_deadline_minutes: 120,
  is_demo: false,
}

const draft = (overrides: Partial<SettingsDraft> = {}): SettingsDraft => ({ ...draftOf(saved), ...overrides })

describe('number and unit (D92)', () => {
  it.each([
    [1440, '1', 'days'],
    [2880, '2', 'days'],
    [60, '1', 'hours'],
    [120, '2', 'hours'],
    [90, '90', 'minutes'],
    [1500, '25', 'hours'],
    [0, '0', 'minutes'],
    [43_200, '30', 'days'],
  ])('shows %i minutes in the largest unit that divides it: %s %s', (minutes, amount, unit) => {
    expect(splitMinutes(minutes)).toEqual({ amount, unit })
  })

  it('turns the amount back into minutes, and refuses what is not whole', () => {
    expect(toMinutes({ amount: '2', unit: 'days' })).toBe(2880)
    expect(toMinutes({ amount: ' 3 ', unit: 'hours' })).toBe(180)
    expect(toMinutes({ amount: '1,5', unit: 'hours' })).toBeNull()
    expect(toMinutes({ amount: '', unit: 'minutes' })).toBeNull()
  })

  it('says a value as the page does', () => {
    expect(describeMinutes(1440)).toBe('1 dia')
    expect(describeMinutes(43_200)).toBe('30 dias')
    expect(describeMinutes(60)).toBe('1 hora')
    expect(describeMinutes(90)).toBe('90 minutos')
    expect(describeMinutes(1)).toBe('1 minuto')
  })
})

describe('limits of the business (UC05)', () => {
  it('opens with the saved values, each in its unit', () => {
    expect(draftOf(saved)).toMatchObject({
      minAdvance: '1',
      minAdvanceUnit: 'hours',
      maxAdvance: '30',
      deadline: '2',
      deadlineUnit: 'hours',
    })
    expect(problemsOf(draftOf(saved))).toEqual({})
  })

  it('refuses a minimum advance above the maximum before sending (RN05)', () => {
    expect(problemsOf(draft({ minAdvance: '31', minAdvanceUnit: 'days' })).minAdvance).toBe(
      'A antecedência mínima não pode passar da máxima (30 dias).',
    )
    // Exactly the maximum is accepted, as in the API.
    expect(problemsOf(draft({ minAdvance: '30', minAdvanceUnit: 'days' }))).toEqual({})
    expect(problemsOf(draft({ minAdvance: '25', minAdvanceUnit: 'hours', maxAdvance: '1' })).minAdvance).toBe(
      'A antecedência mínima não pode passar da máxima (1 dia).',
    )
  })

  it('keeps each value within the limits of the API', () => {
    expect(problemsOf(draft({ maxAdvance: '0' })).maxAdvance).toBe('Use de 1 a 365 dias.')
    expect(problemsOf(draft({ maxAdvance: '366' })).maxAdvance).toBe('Use de 1 a 365 dias.')
    expect(problemsOf(draft({ maxAdvance: '1,5' })).maxAdvance).toBe('Use um número inteiro de dias.')
    expect(problemsOf(draft({ maxAdvance: '' })).maxAdvance).toContain('Informe')
    expect(problemsOf(draft({ maxAdvance: '365', minAdvance: '366', minAdvanceUnit: 'days' })).minAdvance).toBe(
      'A antecedência mínima vai até 365 dias.',
    )
    expect(problemsOf(draft({ minAdvance: '' })).minAdvance).toBe('Informe a antecedência mínima, ou 0.')
    expect(problemsOf(draft({ minAdvance: 'x' })).minAdvance).toBe('Use um número inteiro.')
    expect(problemsOf(draft({ deadline: '31', deadlineUnit: 'days' })).deadline).toBe('O prazo vai até 30 dias.')
    expect(problemsOf(draft({ deadline: '30', deadlineUnit: 'days' }))).toEqual({})
    expect(problemsOf(draft({ deadline: '' })).deadline).toContain('Informe')
    expect(problemsOf(draft({ deadline: '2.5' })).deadline).toBe('Use um número inteiro.')
    expect(problemsOf(draft({ step: 7 })).step).toBe('Escolha um dos passos da grade.')
    expect(problemsOf(draft({ timezone: '' })).timezone).toBe('Escolha o fuso do negócio.')
  })

  it('checks the name and the slug as the API does', () => {
    expect(problemsOf(draft({ name: ' ' })).name).toBe('Informe o nome do negócio.')
    expect(problemsOf(draft({ name: 'a'.repeat(121) })).name).toBe('Use até 120 caracteres.')
    expect(problemsOf(draft({ slug: 'ab' })).slug).toBe('Use de 3 a 63 caracteres.')
    expect(problemsOf(draft({ slug: 'a'.repeat(64) })).slug).toBe('Use de 3 a 63 caracteres.')
    for (const slug of ['-abc', 'abc-', 'a--b', 'café', 'a_b']) {
      expect(problemsOf(draft({ slug })).slug).toContain('Use só letras minúsculas')
    }
    expect(problemsOf(draft({ slug: 'barbearia-2' }))).toEqual({})
  })

  it('keeps the slug in lowercase, with hyphens for spaces', () => {
    expect(normalizeSlug('Barbearia Central')).toBe('barbearia-central')
    expect(normalizeSlug('Café  Bar')).toBe('café-bar')
  })

  it('sends only what changed, in minutes', () => {
    expect(changesOf(saved, draftOf(saved))).toEqual({})
    expect(
      changesOf(
        saved,
        draft({
          name: ' Barbearia Nova ',
          slug: 'nova',
          timezone: 'America/Manaus',
          step: 30,
          minAdvance: '1',
          minAdvanceUnit: 'days',
          maxAdvance: '60',
          deadline: '0',
          deadlineUnit: 'minutes',
        }),
      ),
    ).toEqual({
      name: 'Barbearia Nova',
      slug: 'nova',
      timezone: 'America/Manaus',
      slot_step_minutes: 30,
      min_advance_minutes: 1440,
      max_advance_days: 60,
      change_deadline_minutes: 0,
    })
    // The same value in another unit is no change.
    expect(changesOf(saved, draft({ minAdvance: '60', minAdvanceUnit: 'minutes' }))).toEqual({})
  })
})

describe('time zones', () => {
  const now = new Date('2026-11-12T16:00:00Z')

  it('names the zone with its offset at that moment, with a true minus sign', () => {
    expect(offsetOf('America/Sao_Paulo', now)).toBe('GMT−3')
    expect(offsetOf('Asia/Kolkata', now)).toBe('GMT+5:30')
    expect(offsetOf('Not/AZone', now)).toBe('')
    expect(zoneLabel('America/Sao_Paulo', now)).toBe('São Paulo e Brasília · GMT−3')
    expect(zoneLabel('America/Argentina/Buenos_Aires', now)).toBe('Buenos Aires (Argentina) · GMT−3')
    expect(zoneLabel('UTC', now)).toBe('UTC · GMT+0')
    expect(zoneLabel('Not/AZone', now)).toBe('AZone')
  })

  it('in summer, São Paulo of 2018 had daylight saving time', () => {
    expect(offsetOf('America/Sao_Paulo', new Date('2018-12-01T12:00:00Z'))).toBe('GMT−2')
  })

  it('puts Brazil first, then the regions, and always offers the current zone', () => {
    const groups = zoneGroups('Etc/GMT+3', now, ['Europe/Lisbon', 'America/Manaus', 'America/Sao_Paulo', 'Asia/Tokyo', 'UTC'])
    expect(groups.map((group) => group.label)).toEqual(['Brasil', 'Ásia', 'Europa', 'Outros'])
    expect(groups[0].zones.map((zone) => zone.value)).toEqual(['America/Sao_Paulo', 'America/Manaus'])
    expect(groups.at(-1)?.zones.map((zone) => zone.value)).toEqual(['Etc/GMT+3', 'UTC'])
  })

  it('works with the list of the browser, which has São Paulo', () => {
    const groups = zoneGroups('America/Sao_Paulo', now)
    expect(groups[0].label).toBe('Brasil')
    expect(groups[0].zones[0].value).toBe('America/Sao_Paulo')
    expect(groups.flatMap((group) => group.zones).length).toBeGreaterThan(100)
  })
})
