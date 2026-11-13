import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'

import { ApiError } from '@/api/errors'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { customerFieldOf, SelectField, SERVER_FIELD_MESSAGES } from '@/features/scheduling'
import { toUtcInstant } from '@/lib/datetime'
import { formatDuration, formatPrice } from '@/lib/format'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'

import { appointmentSchema, type AppointmentInput, type AppointmentValues } from '../appointment-schema'
import { refusalMessage, slotProblemMessage, slotRefusalOf } from '../messages'
import {
  teamKeys,
  useCreateAppointment,
  type CreatedAppointment,
  type Professional,
  type Service,
} from '../queries'
import { checkSlot } from '../slot-check'
import { useSlotContext } from '../use-slot-context'
import { servicesOf } from '../viewer'
import { StaffTimeField } from './StaffTimeField'

interface AppointmentFormProps {
  /** Who can take the appointment: all who can book (Owner) or the own record. */
  bookable: Professional[]
  /** Fixed for a Professional, who books only in the own agenda (UC16). */
  fixedProfessional: boolean
  services: Service[]
  timeZone: string
  today: string
  now: Date
  initial: Pick<AppointmentInput, 'professionalId' | 'day'>
  onCreated: (created: CreatedAppointment) => void
}

const CUSTOMER_FIELDS = [
  { name: 'name', label: 'Nome do cliente', type: 'text', autoComplete: 'off' },
  {
    name: 'email',
    label: 'E-mail (opcional)',
    type: 'email',
    autoComplete: 'off',
    inputMode: 'email',
    description: 'Com e-mail, o cliente recebe o link para consultar, cancelar ou remarcar.',
  },
  {
    name: 'phone',
    label: 'Telefone (opcional)',
    type: 'tel',
    autoComplete: 'off',
    inputMode: 'tel',
    description: 'Com DDD. Se não for do Brasil, comece com + e o código do país.',
  },
] as const

/**
 * UC16 (D82). The team books without the grid (RN19): the time is typed to
 * the minute. Before sending, the time field tells a past time or one out of
 * the working hours; a `409` is told by its `reason` (D83), and the form keeps
 * what was typed.
 */
export function AppointmentForm({
  bookable,
  fixedProfessional,
  services,
  timeZone,
  today,
  now,
  initial,
  onCreated,
}: AppointmentFormProps) {
  const queryClient = useQueryClient()
  const form = useForm<AppointmentInput, unknown, AppointmentValues>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: {
      professionalId: initial.professionalId,
      serviceId: '',
      day: initial.day,
      time: '',
      name: '',
      email: '',
      phone: '',
    },
    mode: 'onTouched',
  })
  const mutation = useCreateAppointment()
  useUnsavedChanges(form.formState.isDirty)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const [timeTouched, setTimeTouched] = useState(false)
  const timeRef = useRef<HTMLInputElement>(null)
  const sending = useRef(false)

  const [professionalId, serviceId, day, time] = useWatch({
    control: form.control,
    name: ['professionalId', 'serviceId', 'day', 'time'],
  })
  const professional = bookable.find((item) => item.id === professionalId)
  const offered = professional === undefined ? [] : servicesOf(professional, services)
  const service = offered.find((item) => item.id === serviceId)
  const blockMinutes = service === undefined ? 0 : service.duration_minutes + service.preparation_minutes
  const professionalName = professional?.name ?? 'o profissional'

  const context = useSlotContext({ professionalId, day, timeZone, now, blockMinutes })
  const check = checkSlot({
    localDate: day,
    time,
    timeZone,
    now,
    working: context.working,
    blockMinutes,
  })
  const timeError = form.formState.errors.day?.message ?? form.formState.errors.time?.message
  const showProblem = (timeTouched || form.formState.isSubmitted) && time !== '' && !check.ok
  const problem =
    timeError ??
    (showProblem && !check.ok
      ? slotProblemMessage(check.problem, {
          professional: professionalName,
          working: context.working,
          durationMinutes: service?.duration_minutes ?? 0,
          preparationMinutes: service?.preparation_minutes ?? 0,
        })
      : null)

  const clearRefusal = () => setRefusal(null)

  const send = async (values: AppointmentValues) => {
    setFailure(null)
    setRefusal(null)
    const slot = checkSlot({
      localDate: values.day,
      time: values.time,
      timeZone,
      now: new Date(),
      working: context.working,
      blockMinutes,
    })
    if (!slot.ok) {
      timeRef.current?.focus()
      return
    }
    try {
      const created = await mutation.mutateAsync({
        professional_id: values.professionalId,
        service_id: values.serviceId,
        starts_at: toUtcInstant(slot.instant),
        customer: { name: values.name, email: values.email, phone: values.phone },
      })
      onCreated(created)
    } catch (error) {
      const reason = slotRefusalOf(error)
      if (reason !== undefined) {
        // The agenda and the blocks of the moment, for free ranges that are true again.
        void queryClient.invalidateQueries({ queryKey: teamKeys.timeBlocks(values.professionalId) })
        setRefusal(refusalMessage(reason, professionalName))
        timeRef.current?.focus()
        return
      }
      let mapped = false
      if (error instanceof ApiError) {
        for (const item of error.fieldErrors) {
          const field = customerFieldOf(item.field)
          if (field === null) continue
          form.setError(field, { message: SERVER_FIELD_MESSAGES[field] }, { shouldFocus: !mapped })
          mapped = true
        }
        if (!mapped && error.status === 422) {
          // A service or professional changed meanwhile (RN07): read them again.
          void queryClient.invalidateQueries({ queryKey: teamKeys.services })
          void queryClient.invalidateQueries({ queryKey: teamKeys.professionals })
        }
      }
      if (!mapped) setFailure(error)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current) return
    sending.current = true
    void form.handleSubmit(send)(event).finally(() => {
      sending.current = false
    })
  }

  const busy = mutation.isPending

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup className="gap-5">
        <Controller
          name="professionalId"
          control={form.control}
          render={({ field, fieldState }) =>
            fixedProfessional ? (
              <div className="flex flex-col gap-1">
                <p className="text-[0.9375rem] font-medium">Profissional</p>
                <p className="text-base text-muted-foreground">{professional?.name}</p>
              </div>
            ) : (
              <SelectField
                id="novo-profissional"
                label="Profissional"
                placeholder="Escolha o profissional"
                value={field.value}
                onValueChange={(next) => {
                  field.onChange(next)
                  const nextProfessional = bookable.find((item) => item.id === next)
                  const stillOffered =
                    nextProfessional !== undefined &&
                    servicesOf(nextProfessional, services).some((item) => item.id === serviceId)
                  if (!stillOffered) form.setValue('serviceId', '')
                  clearRefusal()
                }}
                options={bookable.map((item) => ({ value: item.id, label: item.name }))}
                error={fieldState.error?.message}
                disabled={busy}
                triggerRef={field.ref}
              />
            )
          }
        />
        <Controller
          name="serviceId"
          control={form.control}
          render={({ field, fieldState }) => (
            <SelectField
              id="novo-servico"
              label="Serviço"
              placeholder={professional === undefined ? 'Escolha antes o profissional' : 'Escolha o serviço'}
              value={field.value}
              onValueChange={(next) => {
                field.onChange(next)
                clearRefusal()
              }}
              options={offered.map((item) => ({
                value: item.id,
                label: item.name,
                hint: `${formatDuration(item.duration_minutes)} · ${formatPrice(item.price_cents)}`,
              }))}
              error={fieldState.error?.message}
              description={
                service !== undefined && service.preparation_minutes > 0
                  ? `Mais ${formatDuration(service.preparation_minutes)} de preparo depois do atendimento.`
                  : undefined
              }
              disabled={busy || professional === undefined}
              triggerRef={field.ref}
            />
          )}
        />
        <Controller
          name="time"
          control={form.control}
          render={({ field }) => (
            <StaffTimeField
              idPrefix="novo"
              day={day}
              onDayChange={(next) => {
                form.setValue('day', next, { shouldValidate: form.formState.isSubmitted })
                clearRefusal()
              }}
              time={field.value}
              onTimeChange={(next) => {
                field.onChange(next)
                clearRefusal()
              }}
              onTimeBlur={() => {
                field.onBlur()
                setTimeTouched(true)
              }}
              today={today}
              timeZone={timeZone}
              professionalName={professionalName}
              blockMinutes={blockMinutes}
              context={context}
              problem={problem}
              refusal={refusal}
              disabled={busy}
              timeRef={(node) => {
                timeRef.current = node
                field.ref(node)
              }}
            />
          )}
        />
      </FieldGroup>

      <FieldSet className="gap-4">
        <FieldLegend className="text-base font-semibold">Cliente</FieldLegend>
        <FieldGroup className="gap-5">
          {CUSTOMER_FIELDS.map((item) => (
            <Controller
              key={item.name}
              name={item.name}
              control={form.control}
              render={({ field, fieldState }) => {
                const id = `novo-cliente-${item.name}`
                const hint = 'description' in item ? `${id}-dica` : undefined
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
                      inputMode={'inputMode' in item ? item.inputMode : undefined}
                      aria-invalid={fieldState.invalid}
                      aria-describedby={[errorId, hint].filter(Boolean).join(' ') || undefined}
                      readOnly={busy}
                      className="h-11 text-base"
                    />
                    {fieldState.error !== undefined ? (
                      <FieldError id={errorId}>{fieldState.error.message}</FieldError>
                    ) : null}
                    {'description' in item ? (
                      <FieldDescription id={hint}>{item.description}</FieldDescription>
                    ) : null}
                  </Field>
                )
              }}
            />
          ))}
        </FieldGroup>
      </FieldSet>

      {failure !== null ? <ErrorMessage error={failure} title="Não foi possível criar o agendamento" /> : null}

      <Button type="submit" size="lg" disabled={busy} className="h-11 w-full px-6 text-base sm:w-auto sm:self-end">
        {busy ? (
          <>
            <Spinner aria-hidden="true" />
            Criando…
          </>
        ) : (
          'Criar agendamento'
        )}
      </Button>
    </form>
  )
}
