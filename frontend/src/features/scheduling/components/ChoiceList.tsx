import type { ReactNode } from 'react'

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export interface Choice {
  value: string
  title: string
  description?: ReactNode
  /** Extra text on the right, such as the price. */
  aside?: ReactNode
  disabled?: boolean
}

interface ChoiceListProps {
  label: string
  name: string
  choices: Choice[]
  value: string | undefined
  onValueChange: (value: string) => void
}

/**
 * A list of choice cards (shadcn `RadioGroup` + `Field`). Each card is at
 * least 56 px tall, above the 44 px touch target (D55).
 */
export function ChoiceList({ label, name, choices, value, onValueChange }: ChoiceListProps) {
  return (
    <RadioGroup
      aria-label={label}
      name={name}
      value={value ?? ''}
      onValueChange={onValueChange}
      className="gap-2.5"
    >
      {choices.map((choice) => {
        const id = `${name}-${choice.value}`
        const describedBy = [
          choice.description !== undefined ? `${id}-descricao` : '',
          choice.aside !== undefined ? `${id}-extra` : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <FieldLabel
            key={choice.value}
            htmlFor={id}
            className="cursor-pointer rounded-xl! bg-card shadow-xs transition-[background-color,border-color] duration-(--duration-fast) has-data-checked:border-primary! has-data-checked:bg-accent! has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-muted/60 has-[:disabled]:shadow-none dark:has-data-checked:bg-accent!"
          >
            <Field
              orientation="horizontal"
              data-disabled={choice.disabled ? true : undefined}
              className="min-h-14 items-center! gap-3 p-3.5! sm:p-4!"
            >
              <RadioGroupItem
                value={choice.value}
                id={id}
                disabled={choice.disabled}
                aria-labelledby={`${id}-titulo`}
                aria-describedby={describedBy || undefined}
              />
              <FieldContent className="gap-1">
                <FieldTitle id={`${id}-titulo`} className="text-base font-semibold">
                  {choice.title}
                </FieldTitle>
                {choice.description !== undefined ? (
                  <FieldDescription id={`${id}-descricao`} className="text-sm">
                    {choice.description}
                  </FieldDescription>
                ) : null}
              </FieldContent>
              {choice.aside !== undefined ? (
                <span id={`${id}-extra`} className="shrink-0 text-base font-semibold tabular-nums">
                  {choice.aside}
                </span>
              ) : null}
            </Field>
          </FieldLabel>
        )
      })}
    </RadioGroup>
  )
}
