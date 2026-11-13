import { describe, expect, it } from 'vitest'

import {
  bodyOf,
  byName,
  changesOf,
  draftOf,
  parsePrice,
  priceText,
  problemsOf,
  type Service,
  type ServiceDraft,
} from './service-draft'

const corte: Service = {
  id: 's1',
  name: 'Corte',
  duration_minutes: 30,
  preparation_minutes: 10,
  price_cents: 5000,
  is_active: true,
}

const draft = (overrides: Partial<ServiceDraft> = {}): ServiceDraft => ({
  name: 'Corte',
  duration: '30',
  preparation: '10',
  price: '50,00',
  ...overrides,
})

describe('price in cents (D90)', () => {
  it.each([
    ['50', 5000],
    ['50,5', 5050],
    ['49,90', 4990],
    ['1.234,56', 123456],
    ['1.234', 123400],
    ['50.50', 5050],
    ['R$ 50,00', 5000],
    [' 0 ', 0],
    ['1.000.000,00', 100_000_000],
    ['0,01', 1],
  ])('reads %s as %i cents, with integer math', (text, cents) => {
    expect(parsePrice(text)).toEqual({ ok: true, cents })
  })

  it('never loses a cent to float rounding', () => {
    // 0.29 * 100 is 28.999999999999996 in floating point.
    expect(parsePrice('0,29')).toEqual({ ok: true, cents: 29 })
    expect(parsePrice('1,15')).toEqual({ ok: true, cents: 115 })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'format'],
    ['12,345', 'format'],
    ['1,2,3', 'format'],
    ['-5', 'format'],
    ['12.34.56', 'format'],
    ['1.000.000,01', 'max'],
    ['99999999999', 'max'],
  ])('refuses %j (%s)', (text, reason) => {
    expect(parsePrice(text)).toEqual({ ok: false, reason })
  })

  it('shows cents as reais with the comma and the thousands point', () => {
    expect(priceText(5000)).toBe('50,00')
    expect(priceText(123456)).toBe('1.234,56')
    expect(priceText(0)).toBe('0,00')
  })
})

describe('limits of the service (UC06)', () => {
  it('accepts the edges of the API', () => {
    expect(problemsOf(draft({ duration: '1', preparation: '0', price: '0' }))).toEqual({})
    expect(problemsOf(draft({ duration: '1440', preparation: '1440', price: '1.000.000,00' }))).toEqual({})
    expect(problemsOf(draft({ name: 'a'.repeat(120) }))).toEqual({})
  })

  it('tells each field what is wrong, past the edges', () => {
    expect(problemsOf(draft({ name: '  ', duration: '0', preparation: '1441', price: '' }))).toEqual({
      name: 'Informe o nome do serviço.',
      duration: 'A duração vai de 1 a 1440 minutos (24 horas).',
      preparation: 'O preparo vai de 0 a 1440 minutos (24 horas).',
      price: 'Informe o preço, como 50,00. Use 0 para um serviço gratuito.',
    })
    expect(problemsOf(draft({ name: 'a'.repeat(121), duration: '1441' }))).toMatchObject({
      name: 'Use até 120 caracteres.',
      duration: 'A duração vai de 1 a 1440 minutos (24 horas).',
    })
  })

  it('counts the name in characters, as the API', () => {
    // 120 emoji are 240 UTF-16 units, but 120 characters.
    expect(problemsOf(draft({ name: '✂️'.repeat(60) }))).toEqual({})
    expect(problemsOf(draft({ name: '💈'.repeat(120) }))).toEqual({})
    expect(problemsOf(draft({ name: '💈'.repeat(121) })).name).toBe('Use até 120 caracteres.')
  })

  it('wants whole minutes, and an empty preparation is not zero', () => {
    expect(problemsOf(draft({ duration: '30,5' })).duration).toBe('Use um número inteiro de minutos, sem vírgula.')
    expect(problemsOf(draft({ duration: '' })).duration).toBe('Informe a duração, em minutos.')
    expect(problemsOf(draft({ preparation: '' })).preparation).toBe('Informe o preparo, em minutos, ou 0.')
  })
})

describe('the body and the changes', () => {
  it('starts a new service with no preparation, and an edited one with its values', () => {
    expect(draftOf()).toEqual({ name: '', duration: '', preparation: '0', price: '' })
    expect(draftOf(corte)).toEqual(draft())
  })

  it('sends the price in cents and the name without spaces around it', () => {
    expect(bodyOf(draft({ name: '  Corte  ', price: '1.234,5' }))).toEqual({
      name: 'Corte',
      duration_minutes: 30,
      preparation_minutes: 10,
      price_cents: 123450,
    })
  })

  it('throws when a price that was not checked reaches the body', () => {
    expect(() => bodyOf(draft({ price: 'x' }))).toThrow()
  })

  it('sends only what changed, so a locked name on the demo is left out (RN28)', () => {
    expect(changesOf(corte, bodyOf(draft()))).toEqual({})
    expect(changesOf(corte, bodyOf(draft({ price: '55' })))).toEqual({ price_cents: 5500 })
    expect(changesOf(corte, bodyOf(draft({ name: 'Corte novo', duration: '40', preparation: '0' })))).toEqual({
      name: 'Corte novo',
      duration_minutes: 40,
      preparation_minutes: 0,
    })
  })

  it('orders by name in Portuguese', () => {
    const names = ['Sobrancelha', 'barba', 'Árvore', 'Corte'].map((name) => ({ ...corte, name }))
    expect(names.sort(byName).map((service) => service.name)).toEqual(['Árvore', 'barba', 'Corte', 'Sobrancelha'])
  })
})
