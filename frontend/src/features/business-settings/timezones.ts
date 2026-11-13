/**
 * The time zones offered to the business (D92). The API has no list: it
 * accepts any IANA name it knows, so the page uses the browser's
 * (`Intl.supportedValuesOf`), always with the current one, and a name the API
 * refuses comes back as a `422` on the field.
 */

/** The IANA zones of Brazil, first in the list, with the names as Brazilians write them. */
const BRAZIL: Record<string, string> = {
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

const REGIONS: Record<string, string> = {
  America: 'Américas',
  Europe: 'Europa',
  Africa: 'África',
  Asia: 'Ásia',
  Australia: 'Austrália',
  Pacific: 'Pacífico',
  Atlantic: 'Atlântico',
  Indian: 'Oceano Índico',
  Antarctica: 'Antártida',
  Arctic: 'Ártico',
}

export interface ZoneOption {
  value: string
  label: string
}

export interface ZoneGroup {
  label: string
  zones: ZoneOption[]
}

/** `GMT−3`, `GMT+5:30` or `GMT+0`, at `now`, which changes with daylight saving time. */
export function offsetOf(timeZone: string, now: Date): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(now)
      .find((item) => item.type === 'timeZoneName')
    return (part?.value ?? 'GMT').replace('-', '−')
  } catch {
    return ''
  }
}

/** `Buenos Aires (Argentina)` from `America/Argentina/Buenos_Aires`. */
function placeOf(timeZone: string): string {
  const parts = timeZone.split('/').map((part) => part.replaceAll('_', ' '))
  if (parts.length <= 1) return parts[0]
  const city = parts.at(-1)!
  return parts.length > 2 ? `${city} (${parts.slice(1, -1).join(', ')})` : city
}

export function zoneLabel(timeZone: string, now: Date): string {
  const offset = offsetOf(timeZone, now)
  const place = BRAZIL[timeZone] ?? placeOf(timeZone)
  return offset === '' ? place : `${place} · ${offset}`
}

function supportedZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

/** Brazil first, then each region in alphabetical order of the place. */
export function zoneGroups(current: string, now: Date, available: string[] = supportedZones()): ZoneGroup[] {
  const all = new Set(available)
  all.add(current)
  const brazil: ZoneOption[] = []
  const regions = new Map<string, ZoneOption[]>()
  for (const zone of all) {
    const option = { value: zone, label: zoneLabel(zone, now) }
    if (zone in BRAZIL) {
      brazil.push(option)
      continue
    }
    const region = REGIONS[zone.split('/')[0]] ?? 'Outros'
    regions.set(region, [...(regions.get(region) ?? []), option])
  }
  const byLabel = (a: ZoneOption, b: ZoneOption) => a.label.localeCompare(b.label, 'pt-BR')
  const brazilOrder = Object.keys(BRAZIL)
  brazil.sort((a, b) => brazilOrder.indexOf(a.value) - brazilOrder.indexOf(b.value))
  const rest = [...regions.entries()]
    .sort(([a], [b]) => (a === 'Outros' ? 1 : b === 'Outros' ? -1 : a.localeCompare(b, 'pt-BR')))
    .map(([label, zones]) => ({ label, zones: zones.sort(byLabel) }))
  return [{ label: 'Brasil', zones: brazil }, ...rest].filter((group) => group.zones.length > 0)
}
