import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { ApiError } from '@/api/errors'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

import {
  customerFieldOf,
  customerSchema,
  SERVER_FIELD_MESSAGES,
  toE164,
  type CustomerInput,
  type CustomerValues,
} from '../customer-schema'
import { useIdempotencyKey } from '../idempotency'
import { useCreateBooking, type Booking, type CreateBookingBody } from '../queries'
import { ContinueButton } from '@/features/scheduling'
import { useRetryAfter } from '@/hooks/use-retry-after'

interface CustomerStepProps {
  slug: string
  serviceId: string
  professionalId: string | null
  startsAt: string
  /** Typed data kept while the customer goes back to another step. */
  draft: CustomerInput
  onDraftChange: (draft: CustomerInput) => void
  idempotency: ReturnType<typeof useIdempotencyKey>
  onBooked: (booking: Booking, email: string) => void
  /** `409 SLOT_UNAVAILABLE`: the slot was taken in the meantime. */
  onSlotTaken: () => void
}

const FIELDS: {
  name: keyof CustomerInput
  label: string
  type: string
  autoComplete: string
  inputMode?: 'email' | 'tel'
  description?: string
}[] = [
  { name: 'name', label: 'Nome', type: 'text', autoComplete: 'name' },
  {
    name: 'email',
    label: 'E-mail',
    type: 'email',
    autoComplete: 'email',
    inputMode: 'email',
    description: 'Enviamos para ele o link do agendamento.',
  },
  {
    name: 'phone',
    label: 'Telefone',
    type: 'tel',
    autoComplete: 'tel',
    inputMode: 'tel',
    description: 'Com DDD. Se o número não for do Brasil, comece com + e o código do país.',
  },
]

export function CustomerStep({
  slug,
  serviceId,
  professionalId,
  startsAt,
  draft,
  onDraftChange,
  idempotency,
  onBooked,
  onSlotTaken,
}: CustomerStepProps) {
  const form = useForm<CustomerInput, unknown, CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: draft,
    mode: 'onTouched',
  })
  const mutation = useCreateBooking(slug)
  const [failure, setFailure] = useState<unknown>(null)
  const { waiting, label: waitText, holdFor, holding } = useRetryAfter()
  const formRef = useRef<HTMLFormElement>(null)
  // Set synchronously on submit: a double click never sends twice (D64).
  const sending = useRef(false)

  // Keeps what was typed when the step closes (e.g. back to the slots after a 409).
  useEffect(() => () => onDraftChange(form.getValues()), [form, onDraftChange])

  const submit = form.handleSubmit(async (values) => {
    const body: CreateBookingBody = {
      service_id: serviceId,
      professional_id: professionalId,
      starts_at: startsAt,
      customer: { name: values.name, email: values.email, phone: toE164(values.phone) ?? values.phone },
    }
    setFailure(null)
    try {
      const booking = await mutation.mutateAsync({ body, idempotencyKey: idempotency.keyFor(body) })
      onBooked(booking, values.email)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SLOT_UNAVAILABLE') {
        onSlotTaken()
        return
      }
      if (error instanceof ApiError && error.code === 'IDEMPOTENCY_KEY_REUSED') idempotency.reset()
      // 429: holds the button until the `Retry-After` ends.
      holdFor(error)
      let mapped = false
      if (error instanceof ApiError) {
        for (const item of error.fieldErrors) {
          const field = customerFieldOf(item.field)
          if (field === null) continue
          form.setError(field, { message: SERVER_FIELD_MESSAGES[field] }, { shouldFocus: !mapped })
          mapped = true
        }
      }
      if (!mapped) setFailure(error)
    }
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current || holding()) return
    sending.current = true
    void submit(event).finally(() => {
      sending.current = false
    })
  }

  const busy = mutation.isPending

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup className="gap-5">
        {FIELDS.map((item) => (
          <Controller
            key={item.name}
            name={item.name}
            control={form.control}
            render={({ field, fieldState }) => {
              const id = `cliente-${item.name}`
              const hint = item.description !== undefined ? `${id}-dica` : undefined
              const errorId = fieldState.invalid ? `${id}-erro` : undefined
              return (
                <Field data-invalid={fieldState.invalid} className="gap-1.5">
                  <FieldLabel htmlFor={id} className="text-[0.9375rem] text-foreground">
                    {item.label}
                  </FieldLabel>
                  <Input
                    {...field}
                    id={id}
                    type={item.type}
                    autoComplete={item.autoComplete}
                    inputMode={item.inputMode}
                    aria-invalid={fieldState.invalid}
                    aria-describedby={[errorId, hint].filter(Boolean).join(' ') || undefined}
                    readOnly={busy}
                    className="h-11 text-base"
                  />
                  {fieldState.error !== undefined ? (
                    <FieldError id={errorId}>{fieldState.error.message}</FieldError>
                  ) : null}
                  {item.description !== undefined ? (
                    <FieldDescription id={hint}>{item.description}</FieldDescription>
                  ) : null}
                </Field>
              )
            }}
          />
        ))}
      </FieldGroup>

      {failure !== null ? (
        <ErrorMessage
          error={failure}
          title="Não foi possível confirmar"
          onRetry={waiting ? undefined : () => formRef.current?.requestSubmit()}
        />
      ) : null}

      <ContinueButton disabled={busy || waiting}>
        {busy ? (
          <>
            <Spinner aria-hidden="true" />
            Confirmando…
          </>
        ) : waiting ? (
          waitText
        ) : (
          'Confirmar agendamento'
        )}
      </ContinueButton>
    </form>
  )
}
