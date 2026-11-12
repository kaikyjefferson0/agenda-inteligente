import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  CUSTOMER_MESSAGES,
  customerFieldOf,
  customerName,
  optionalEmail,
  optionalPhone,
  toE164,
} from './customer-rules'

describe('toE164 (D63)', () => {
  it.each([
    ['(11) 98765-4321', '+5511987654321'],
    ['11 3456-7890', '+551134567890'],
    ['011 98765-4321', '+5511987654321'],
    ['55 11 98765-4321', '+5511987654321'],
    ['+55 (11) 98765-4321', '+5511987654321'],
    ['+44 20 7946 0958', '+442079460958'],
    ['+1 (415) 555-0100', '+14155550100'],
  ])('converts %s to %s', (typed, e164) => {
    expect(toE164(typed)).toBe(e164)
  })

  it.each(['', '98765-4321', '123', '+0 11 98765-4321', '+12', 'abc'])('refuses %s', (typed) => {
    expect(toE164(typed)).toBeNull()
  })
})

describe('optional fields of the team (RN19)', () => {
  const schema = z.object({
    name: customerName('Informe o nome do cliente.'),
    email: optionalEmail(),
    phone: optionalPhone(),
  })

  it('takes empty e-mail and phone as none, and the phone in E.164', () => {
    expect(schema.parse({ name: ' Ana ', email: ' ', phone: '' })).toEqual({
      name: 'Ana',
      email: null,
      phone: null,
    })
    expect(schema.parse({ name: 'Ana', email: 'ana@example.com', phone: '(11) 98765-4321' })).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      phone: '+5511987654321',
    })
  })

  it.each([
    [{ name: '' }, 'Informe o nome do cliente.'],
    [{ email: 'ana@' }, CUSTOMER_MESSAGES.emailInvalid],
    [{ phone: '1234' }, CUSTOMER_MESSAGES.phoneInvalid],
  ])('refuses %o with its own text', (change, message) => {
    const result = schema.safeParse({ name: 'Ana', email: '', phone: '', ...change })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message)
  })
})

describe('customerFieldOf', () => {
  it('maps the fields of a 422 to the form', () => {
    expect(customerFieldOf('customer.name')).toBe('name')
    expect(customerFieldOf('customer.email')).toBe('email')
    expect(customerFieldOf('customer.phone')).toBe('phone')
    expect(customerFieldOf('starts_at')).toBeNull()
  })
})
