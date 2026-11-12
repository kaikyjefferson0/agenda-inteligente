import { Fragment } from 'react'

/**
 * "sexta-feira, 13/11/2026 às 15:00" breaks only after the comma, never
 * inside the weekday nor between the date and the time.
 */
export function Unbroken({ text }: { text: string }) {
  const parts = text.split(', ')
  return parts.map((part, index) => (
    <Fragment key={index}>
      <span className="whitespace-nowrap">
        {part}
        {index < parts.length - 1 ? ',' : null}
      </span>
      {index < parts.length - 1 ? ' ' : null}
    </Fragment>
  ))
}
