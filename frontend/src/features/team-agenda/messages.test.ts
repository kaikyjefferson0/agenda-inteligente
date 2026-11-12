import { describe, expect, it } from 'vitest'

import { ApiError, NetworkError } from '@/api/errors'
import { ERROR_MESSAGES } from '@/api/messages'

import {
  emailNote,
  finalRefusalMessage,
  isFinalRefusal,
  refusalMessage,
  slotProblemMessage,
  slotRefusalOf,
} from './messages'

const refused = (body: Record<string, unknown>) =>
  new ApiError({ status: 409, code: 'SLOT_UNAVAILABLE', body: { code: 'SLOT_UNAVAILABLE', ...body } })

describe('the reason of a 409 (D83)', () => {
  it('comes from the value, not from the detail', () => {
    expect(slotRefusalOf(refused({ reason: 'blocked', detail: 'Outro texto' }))).toBe('blocked')
    expect(slotRefusalOf(refused({}))).toBeNull()
    expect(slotRefusalOf(new ApiError({ status: 409, code: 'INVALID_STATUS_TRANSITION' }))).toBeUndefined()
    expect(slotRefusalOf(new NetworkError())).toBeUndefined()
  })

  it.each([
    ['changed_meanwhile', /Outra pessoa alterou este agendamento/],
    ['in_past', /Este horário já passou/],
    ['outside_working_hours', /não cabe no expediente de Ana/],
    ['blocked', /bloqueio de Ana/],
    ['appointment_conflict', /outro agendamento de Ana/],
  ] as const)('tells %s in its own words', (reason, text) => {
    expect(refusalMessage(reason, 'Ana')).toMatch(text)
  })

  it('falls back to the general text without a reason', () => {
    expect(refusalMessage(null, 'Ana')).toBe(ERROR_MESSAGES.SLOT_UNAVAILABLE)
  })
})

describe('the time field before sending (D82)', () => {
  const context = { professional: 'Ana', working: [], durationMinutes: 30, preparationMinutes: 0 }

  it('tells a day without working hours and a block without preparation', () => {
    expect(slotProblemMessage('outside_working_hours', context)).toBe('Ana não tem expediente neste dia.')
    expect(
      slotProblemMessage('outside_working_hours', { ...context, working: [{ start: 540, end: 720 }] }),
    ).toBe('Fora do expediente de Ana. Os 30 min do atendimento precisam caber inteiros em 09:00–12:00.')
    expect(slotProblemMessage('nonexistent', context)).toMatch(/não existe neste dia/)
    expect(slotProblemMessage('invalid', context)).toBe('Informe a hora, como 09:30.')
  })
})

describe('after a change', () => {
  it('tells what the e-mail did (RN25, RN26)', () => {
    expect(emailNote('created', 'skipped')).toMatch(/Copie o link acima/)
    expect(emailNote('rescheduled', 'queued')).toMatch(/continua valendo/)
    expect(emailNote('cancelled', 'queued')).toBe('O cliente foi avisado por e-mail.')
  })

  it('tells a final refusal apart from a failure (D84)', () => {
    const gone = new ApiError({ status: 404, code: 'NOT_FOUND' })
    expect(isFinalRefusal(gone)).toBe(true)
    expect(finalRefusalMessage(gone)).toBe('Este agendamento não existe mais. A agenda foi atualizada.')
    expect(isFinalRefusal(new NetworkError())).toBe(false)
    expect(finalRefusalMessage(new NetworkError())).toMatch(/Não foi possível conectar/)
  })
})
