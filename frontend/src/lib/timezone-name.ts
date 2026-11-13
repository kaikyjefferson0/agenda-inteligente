/**
 * The name of a time zone as people read it, the same on every screen: the
 * page of the business, the working hours, the blocks, the booking and the
 * link of the customer. The IANA name never shows.
 */

/** The IANA zones of Brazil, with the names as Brazilians write them, in the order of the list. */
export const BRAZIL_ZONES: Record<string, string> = {
  'America/Sao_Paulo': 'São Paulo e Brasília',
  'America/Bahia': 'Bahia',
  'America/Fortaleza': 'Fortaleza',
  'America/Recife': 'Recife',
  'America/Maceio': 'Maceió',
  'America/Belem': 'Belém',
  'America/Araguaina': 'Araguaína',
  'America/Santarem': 'Santarém',
  'America/Noronha': 'Fernando de Noronha',
  'America/Manaus': 'Manaus',
  'America/Boa_Vista': 'Boa Vista',
  'America/Porto_Velho': 'Porto Velho',
  'America/Campo_Grande': 'Campo Grande',
  'America/Cuiaba': 'Cuiabá',
  'America/Rio_Branco': 'Rio Branco',
  'America/Eirunepe': 'Eirunepé',
}

/** `São Paulo e Brasília`, or `Buenos Aires (Argentina)` from `America/Argentina/Buenos_Aires`. */
export function timeZoneName(timeZone: string): string {
  const brazil = BRAZIL_ZONES[timeZone]
  if (brazil !== undefined) return brazil
  const parts = timeZone.split('/').map((part) => part.replaceAll('_', ' '))
  if (parts.length <= 1) return parts[0]
  const city = parts.at(-1)!
  return parts.length > 2 ? `${city} (${parts.slice(1, -1).join(', ')})` : city
}
