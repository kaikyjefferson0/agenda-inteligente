import { describe, expect, it } from 'vitest'

import { blockPeriodOf, describeBlock, overlappingBlocks, upcomingBlocks } from './block-period'

const SP = 'America/Sao_Paulo'
const input = (overrides: Partial<Parameters<typeof blockPeriodOf>[0]>) => ({
  allDay: false,
  startDay: '2026-11-14',
  startTime: '09:00',
  endDay: '2026-11-14',
  endTime: '12:00',
  ...overrides,
})

const block = (id: string, starts_at: string, ends_at: string) => ({
  id,
  professional_id: 'p',
  starts_at,
  ends_at,
  reason: 'Folga',
})

describe('period of a block (UC09, RN06)', () => {
  it('sends the clock of the business in UTC, with the process in Tokyo', () => {
    expect(blockPeriodOf(input({}), SP)).toEqual({
      kind: 'ok',
      startsAt: '2026-11-14T12:00:00Z',
      endsAt: '2026-11-14T15:00:00Z',
    })
  })

  it('takes whole days from the first instant of the day to the first of the day after', () => {
    expect(blockPeriodOf(input({ allDay: true, endDay: '2026-11-15', startTime: '', endTime: '' }), SP)).toEqual({
      kind: 'ok',
      startsAt: '2026-11-14T03:00:00Z',
      endsAt: '2026-11-16T03:00:00Z',
    })
  })

  it('has 23 hours on the day the clock goes forward, whose midnight never existed', () => {
    // 04/11/2018 in São Paulo: from 23:59 straight to 01:00.
    expect(blockPeriodOf(input({ allDay: true, startDay: '2018-11-04', endDay: '2018-11-04' }), SP)).toEqual({
      kind: 'ok',
      startsAt: '2018-11-04T03:00:00Z',
      endsAt: '2018-11-05T02:00:00Z',
    })
  })

  it('refuses a time skipped by the change, on its field', () => {
    const period = blockPeriodOf(input({ startDay: '2018-11-04', startTime: '00:30', endDay: '2018-11-04' }), SP)
    expect(period).toEqual({
      kind: 'invalid',
      problems: {
        startTime:
          '00:30 não existe em domingo, 04/11/2018: o relógio pula essa hora na mudança de horário. Escolha outro horário.',
      },
    })
    const end = blockPeriodOf(input({ startDay: '2018-11-03', startTime: '22:00', endDay: '2018-11-04', endTime: '00:15' }), SP)
    expect(end.kind === 'invalid' && Object.keys(end.problems)).toEqual(['endTime'])
  })

  it('takes the first occurrence of a time repeated when the clock goes back', () => {
    // 16/02/2019 in São Paulo: midnight went back to 23:00, so 23:30 happened twice.
    expect(
      blockPeriodOf(input({ startDay: '2019-02-16', startTime: '23:30', endDay: '2019-02-17', endTime: '08:00' }), SP),
    ).toEqual({ kind: 'ok', startsAt: '2019-02-17T01:30:00Z', endsAt: '2019-02-17T11:00:00Z' })
  })

  it('refuses an end not after the start, on the end', () => {
    expect(blockPeriodOf(input({ endTime: '09:00' }), SP)).toEqual({
      kind: 'invalid',
      problems: { endTime: 'O fim precisa ser depois do início.' },
    })
    expect(blockPeriodOf(input({ endDay: '2026-11-13', endTime: '18:00' }), SP)).toEqual({
      kind: 'invalid',
      problems: { endDay: 'O fim precisa ser no dia de início ou depois.' },
    })
    expect(blockPeriodOf(input({ allDay: true, endDay: '2026-11-13' }), SP)).toEqual({
      kind: 'invalid',
      problems: { endDay: 'O fim precisa ser no dia de início ou depois.' },
    })
  })

  it('asks for missing days and times; a whole day needs no time', () => {
    expect(blockPeriodOf(input({ startDay: '', startTime: '', endDay: '2026-02-30', endTime: '' }), SP)).toEqual({
      kind: 'invalid',
      problems: {
        startDay: 'Informe o dia de início.',
        endDay: 'Informe o dia de fim.',
        startTime: 'Informe a hora de início.',
        endTime: 'Informe a hora de fim.',
      },
    })
    expect(blockPeriodOf(input({ allDay: true, startTime: '', endTime: '' }), SP).kind).toBe('ok')
  })
})

describe('blocks in the list', () => {
  const blocks = [
    block('b', '2026-11-20T12:00:00Z', '2026-11-20T15:00:00Z'),
    block('a', '2026-11-10T12:00:00Z', '2026-11-10T15:00:00Z'),
    block('c', '2026-11-12T15:00:00Z', '2026-11-12T18:00:00Z'),
  ]

  it('keeps what is to come or under way, by start', () => {
    expect(upcomingBlocks(blocks, new Date('2026-11-12T16:00:00Z')).map((item) => item.id)).toEqual(['c', 'b'])
  })

  it('finds overlaps, with touching periods allowed (RN04)', () => {
    expect(overlappingBlocks(blocks, '2026-11-20T14:00:00Z', '2026-11-20T16:00:00Z').map((item) => item.id)).toEqual([
      'b',
    ])
    expect(overlappingBlocks(blocks, '2026-11-20T15:00:00Z', '2026-11-20T16:00:00Z')).toEqual([])
  })

  it('describes whole days, one day and several days in the clock of the business', () => {
    expect(describeBlock(block('d', '2026-11-14T03:00:00Z', '2026-11-15T03:00:00Z'), SP)).toEqual({
      days: 'sábado, 14/11/2026',
      hours: 'Dia inteiro',
    })
    expect(describeBlock(block('d', '2026-11-14T03:00:00Z', '2026-11-17T03:00:00Z'), SP)).toEqual({
      days: 'sábado, 14/11/2026 a segunda-feira, 16/11/2026',
      hours: 'Dias inteiros',
    })
    expect(describeBlock(block('d', '2026-11-14T12:00:00Z', '2026-11-14T15:30:00Z'), SP)).toEqual({
      days: 'sábado, 14/11/2026',
      hours: '09:00–12:30',
    })
    expect(describeBlock(block('d', '2026-11-14T21:00:00Z', '2026-11-16T12:00:00Z'), SP)).toEqual({
      days: 'sábado, 14/11/2026 a segunda-feira, 16/11/2026',
      hours: '18:00 do primeiro dia às 09:00 do último',
    })
  })
})
