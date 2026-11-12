/**
 * Prices and durations (D63). Prices are always in Brazilian reais: the API
 * has no currency, so a business from another country would need one.
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** `R$ 50,00`, from cents. */
export function formatPrice(cents: number): string {
  return BRL.format(cents / 100)
}

/** `30 min`, `1 h` or `1 h 30 min`. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  if (rest === 0) return `${hours} h`
  return `${hours} h ${rest} min`
}
