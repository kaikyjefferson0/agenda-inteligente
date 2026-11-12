import { describe, expect, it } from 'vitest'

import {
  demoBusiness,
  EMPTY_SERVICE_ID,
  OWNER_ID,
  PROFESSIONAL_ID,
  SERVICE_ID,
  TEAM_SERVICE_ID,
} from '@/test/msw/handlers'

import { currentStep, resolveSelection, stepsOf } from './use-booking-flow'

const TODAY = '2026-11-10'
const select = (search: string) => resolveSelection(demoBusiness, new URLSearchParams(search), TODAY)

describe('resolveSelection (D65)', () => {
  it('starts at the service with nothing chosen', () => {
    const selection = select('')
    expect(selection.service).toBeNull()
    expect(selection.professionalId).toBeUndefined()
    expect(selection.day).toBe(TODAY)
    // Today plus `max_advance_days` (RN05).
    expect(selection.days).toHaveLength(31)
    expect(selection.days.at(-1)).toBe('2026-12-10')
    expect(currentStep(selection, false)).toBe('service')
  })

  it('skips the professional step when only one professional does the service', () => {
    const selection = select(`servico=${SERVICE_ID}&profissional=${OWNER_ID}`)
    expect(selection.professionalId).toBe(PROFESSIONAL_ID)
    expect(selection.choosesProfessional).toBe(false)
    expect(currentStep(selection, false)).toBe('datetime')
    expect(stepsOf(demoBusiness, selection)).toEqual(['service', 'datetime', 'customer'])
  })

  it('reads "qualquer" as any professional and a valid id as that professional', () => {
    expect(select(`servico=${TEAM_SERVICE_ID}&profissional=qualquer`).professionalId).toBeNull()
    expect(select(`servico=${TEAM_SERVICE_ID}&profissional=${OWNER_ID}`).professionalId).toBe(
      OWNER_ID,
    )
    expect(stepsOf(demoBusiness, select(`servico=${TEAM_SERVICE_ID}`))).toHaveLength(4)
  })

  it.each([
    ['an unknown service', 'servico=nao-existe', 'service'],
    ['a service nobody does', `servico=${EMPTY_SERVICE_ID}`, 'service'],
    ['a professional outside the service', `servico=${TEAM_SERVICE_ID}&profissional=outro`, 'professional'],
    ['a missing professional', `servico=${TEAM_SERVICE_ID}`, 'professional'],
  ])('ignores %s and starts at the right step', (_, search, step) => {
    expect(currentStep(select(search), false)).toBe(step)
  })

  it.each(['2026-02-30', '2026-11-09', '2026-12-11', 'amanha'])('ignores the day %s', (day) => {
    expect(select(`servico=${SERVICE_ID}&dia=${day}`).day).toBe(TODAY)
  })

  it('keeps a valid day and moves to the customer data once the slot is offered', () => {
    const selection = select(`servico=${SERVICE_ID}&dia=2026-11-12`)
    expect(selection.day).toBe('2026-11-12')
    expect(currentStep(selection, true)).toBe('customer')
  })

  it('counts four steps before a service is chosen when any service has a team', () => {
    expect(stepsOf(demoBusiness, select(''))).toHaveLength(4)
    const solo = { ...demoBusiness, services: [demoBusiness.services[0]] }
    expect(stepsOf(solo, resolveSelection(solo, new URLSearchParams(), TODAY))).toHaveLength(3)
  })
})
