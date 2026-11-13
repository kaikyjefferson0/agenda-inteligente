import { describe, expect, it } from 'vitest'

import type { Professional } from '@/features/scheduling'

import { inviteProblems, situationOf, teamOrder } from './situation'

const OWNER = 'u-owner'

function member(overrides: Partial<Professional>): Professional {
  return {
    id: 'p',
    user_id: 'u',
    name: 'Nome',
    email: 'nome@exemplo.com',
    is_bookable: true,
    is_active: true,
    invitation_pending: false,
    invitation_expires_at: null,
    service_ids: [],
    ...overrides,
  }
}

describe('situation of each one (D91)', () => {
  it('tells the Owner who serves from the one who stopped, never as deactivated (RN23)', () => {
    expect(situationOf(member({ user_id: OWNER }), OWNER)).toBe('owner-serving')
    expect(situationOf(member({ user_id: OWNER, is_bookable: false }), OWNER)).toBe('owner-not-serving')
  })

  it('tells active, pending and deactivated apart; a deactivated pending invite is deactivated', () => {
    expect(situationOf(member({}), OWNER)).toBe('active')
    expect(situationOf(member({ invitation_pending: true, is_bookable: false }), OWNER)).toBe('pending')
    expect(situationOf(member({ is_active: false, is_bookable: false }), OWNER)).toBe('deactivated')
    expect(situationOf(member({ is_active: false, invitation_pending: true }), OWNER)).toBe('deactivated')
  })

  it('lists the Owner first, then active, pending and deactivated, by name', () => {
    const team = [
      member({ id: '1', name: 'Zeca', is_active: false }),
      member({ id: '2', name: 'Bia', invitation_pending: true }),
      member({ id: '3', name: 'Ana' }),
      member({ id: '4', name: 'Rui', user_id: OWNER }),
      member({ id: '5', name: 'Álvaro' }),
    ]
    expect(team.sort(teamOrder(OWNER)).map((item) => item.name)).toEqual(['Rui', 'Álvaro', 'Ana', 'Bia', 'Zeca'])
  })
})

describe('invite before sending', () => {
  it('asks for the name and a valid e-mail', () => {
    expect(inviteProblems('', '')).toEqual({
      name: 'Informe o nome do profissional.',
      email: 'Informe o e-mail para onde vai o convite.',
    })
    expect(inviteProblems('Ana', 'ana@')).toEqual({ email: 'Confira o e-mail, como nome@exemplo.com.' })
    expect(inviteProblems('a'.repeat(121), 'ana@exemplo.com')).toEqual({ name: 'Use até 120 caracteres.' })
    expect(inviteProblems(' Ana ', ' ana@exemplo.com ')).toEqual({})
  })
})
