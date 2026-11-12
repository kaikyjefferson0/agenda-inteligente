import type { ComponentProps, ReactNode } from 'react'
import type { ControllerFieldState, ControllerRenderProps, FieldValues, Path } from 'react-hook-form'

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

interface TextFieldProps<T extends FieldValues> {
  id: string
  label: string
  field: ControllerRenderProps<T, Path<T>>
  fieldState: ControllerFieldState
  description?: ReactNode
  /** Beside the label, such as "Esqueci minha senha". */
  labelAction?: ReactNode
  /** Replaces the input, for the password with its button. */
  render?: (props: ComponentProps<'input'>) => ReactNode
  inputProps?: ComponentProps<'input'>
}

/** Label, input, error and hint, tied together for screen readers (as in the booking form). */
export function TextField<T extends FieldValues>({
  id,
  label,
  field,
  fieldState,
  description,
  labelAction,
  render,
  inputProps,
}: TextFieldProps<T>) {
  const hintId = description !== undefined ? `${id}-dica` : undefined
  const errorId = fieldState.invalid ? `${id}-erro` : undefined
  const props: ComponentProps<'input'> = {
    ...inputProps,
    ...field,
    value: (field.value as string | undefined) ?? '',
    id,
    'aria-invalid': fieldState.invalid,
    'aria-describedby': [errorId, hintId].filter(Boolean).join(' ') || undefined,
    className: 'h-11 text-base',
  }

  return (
    <Field data-invalid={fieldState.invalid} className="gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel htmlFor={id} className="text-[0.9375rem] text-foreground">
          {label}
        </FieldLabel>
        {labelAction}
      </div>
      {render !== undefined ? render(props) : <Input {...props} />}
      {fieldState.error !== undefined ? (
        <FieldError id={errorId}>{fieldState.error.message}</FieldError>
      ) : null}
      {description !== undefined ? <FieldDescription id={hintId}>{description}</FieldDescription> : null}
    </Field>
  )
}
