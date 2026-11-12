import { describe, expect, it } from 'vitest'

import { isDemoEmail } from './demo'
import { loginPath, safeReturnTo } from './return-to'
import { loginSchema, newPasswordSchema, passwordLength } from './schemas'

describe('RN30: new password', () => {
  const check = (password: string) => newPasswordSchema.safeParse({ password }).success

  it('takes 12 to 128 characters with no composition rule', () => {
    expect(check('a'.repeat(11))).toBe(false)
    expect(check('a'.repeat(12))).toBe(true)
    expect(check('            ')).toBe(true)
    expect(check('a'.repeat(128))).toBe(true)
    expect(check('a'.repeat(129))).toBe(false)
  })

  it('counts characters as the API does (code points), not UTF-16 units', () => {
    expect(passwordLength('💈'.repeat(12))).toBe(12)
    expect(check('💈'.repeat(12))).toBe(true)
    expect(check('💈'.repeat(128))).toBe(true)
  })

  it('never trims the password of the login', () => {
    expect(loginSchema.parse({ email: ' dono@exemplo.com ', password: ' x ' })).toEqual({
      email: 'dono@exemplo.com',
      password: ' x ',
    })
  })
})

describe('?voltar= (D73)', () => {
  it.each([
    ['/painel/servicos', '/painel/servicos'],
    ['/painel?dia=2026-11-10', '/painel?dia=2026-11-10'],
    ['/painel', '/painel'],
    [null, '/painel'],
    ['https://exemplo.com', '/painel'],
    ['//exemplo.com/painel', '/painel'],
    ['/painel//exemplo.com', '/painel'],
    ['/painel\\exemplo', '/painel'],
    ['/painelx', '/painel'],
    ['/n/barbearia-demo', '/painel'],
    ['/painel/\u0000', '/painel'],
  ])('%s → %s', (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected)
  })

  it('only adds the parameter when it is not the panel home', () => {
    expect(loginPath()).toBe('/entrar')
    expect(loginPath('/painel')).toBe('/entrar')
    expect(loginPath('/painel/equipe')).toBe('/entrar?voltar=%2Fpainel%2Fequipe')
    expect(loginPath('https://exemplo.com')).toBe('/entrar')
  })
})

describe('demo accounts (RN28)', () => {
  it('recognizes the demo e-mails', () => {
    expect(isDemoEmail(' Dono@Demo.Example.com ')).toBe(true)
    expect(isDemoEmail('dono@exemplo.com')).toBe(false)
  })
})
