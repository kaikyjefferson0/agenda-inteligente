import { describe, expect, it } from 'vitest'

import { customerSchema, FIELD_MESSAGES } from './customer-schema'

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
