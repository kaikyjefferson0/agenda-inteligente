import { describe, expect, it } from 'vitest'

import { timeZoneName } from './timezone-name'

describe('the name of a time zone, the same on every screen', () => {
  it('writes the zones of Brazil as Brazilians do', () => {
    expect(timeZoneName('America/Sao_Paulo')).toBe('São Paulo e Brasília')
    expect(timeZoneName('America/Cuiaba')).toBe('Cuiabá')
  })

  it('takes the city of any other zone, with the region in between when there is one', () => {
    expect(timeZoneName('America/New_York')).toBe('New York')
    expect(timeZoneName('America/Argentina/Buenos_Aires')).toBe('Buenos Aires (Argentina)')
    expect(timeZoneName('UTC')).toBe('UTC')
  })
})
