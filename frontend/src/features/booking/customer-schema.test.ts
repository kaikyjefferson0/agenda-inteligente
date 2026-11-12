import { describe, expect, it } from 'vitest'

import { customerFieldOf, customerSchema, FIELD_MESSAGES, toE164 } from './customer-schema'

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

describe('customerSchema', () => {
  const valid = { name: '  Ana  ', email: ' ana@example.com ', phone: '(11) 98765-4321' }

  it('accepts and trims valid data', () => {
    expect(customerSchema.parse(valid)).toEqual({
      name: 'Ana',
      email: 'ana@example.com',
      phone: '(11) 98765-4321',
    })
  })

  it.each([
    [{ name: '   ' }, FIELD_MESSAGES.nameRequired],
    [{ name: 'a'.repeat(121) }, FIELD_MESSAGES.nameTooLong],
    [{ name: 'Ana\u0007' }, FIELD_MESSAGES.nameInvalid],
    [{ email: '' }, FIELD_MESSAGES.emailRequired],
    [{ email: 'ana@' }, FIELD_MESSAGES.emailInvalid],
    [{ phone: '' }, FIELD_MESSAGES.phoneRequired],
    [{ phone: '1234' }, FIELD_MESSAGES.phoneInvalid],
  ])('refuses %o with its own text', (change, message) => {
    const result = customerSchema.safeParse({ ...valid, ...change })
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
