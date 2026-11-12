import type { ReactNode, Ref } from 'react'

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface SelectOption {
  value: string
  label: string
  /** Extra text in the list, such as duration and price. */
  hint?: string
}

interface SelectFieldProps {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder: string
  error?: string
  description?: ReactNode
  disabled?: boolean
  triggerRef?: Ref<HTMLButtonElement>
}

/** Label, shadcn `Select`, error and hint, tied together for screen readers (44 px). */
export function SelectField({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder,
  error,
  description,
  disabled = false,
  triggerRef,
}: SelectFieldProps) {
  const errorId = error !== undefined ? `${id}-erro` : undefined
  const hintId = description !== undefined ? `${id}-dica` : undefined
  return (
    <Field data-invalid={error !== undefined} className="gap-1.5">
      <FieldLabel htmlFor={id} className="text-[0.9375rem] text-foreground">
        {label}
      </FieldLabel>
      {/* The name also names the native select Radix keeps hidden for forms. */}
      <Select name={id} value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          ref={triggerRef}
          id={id}
          aria-invalid={error !== undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
          className="h-11! w-full text-base"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-72">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="min-h-11 text-base md:min-h-9">
              {option.label}
              {option.hint !== undefined ? (
                <span className="text-muted-foreground tabular-nums"> · {option.hint}</span>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error !== undefined ? <FieldError id={errorId}>{error}</FieldError> : null}
      {description !== undefined ? <FieldDescription id={hintId}>{description}</FieldDescription> : null}
    </Field>
  )
}
