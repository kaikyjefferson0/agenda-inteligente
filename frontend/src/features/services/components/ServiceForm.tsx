import { LockIcon, SaveIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'

import { ApiError } from '@/api/errors'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { formatDuration } from '@/lib/format'

import { useCreateService, useUpdateService } from '../queries'
import {
  bodyOf,
  changesOf,
  draftOf,
  problemsOf,
  SERVER_FIELDS,
  SERVICE_FIELDS,
  SERVICE_LIMITS,
  type Service,
  type ServiceDraft,
  type ServiceField,
  type ServiceProblems,
} from '../service-draft'

export type ServiceSaved = { kind: 'created' | 'saved' | 'unchanged'; service: Service }

interface ServiceFormProps {
  /** Without it, a new service. */
  service?: Service
  isDemo: boolean
  onSaved: (result: ServiceSaved) => void
  onCancel: () => void
}

const LABELS: Record<ServiceField, string> = {
  name: 'Nome',
  duration: 'Duração',
  preparation: 'Preparo',
  price: 'Preço',
}

/**
 * UC06: name, duration, preparation and price, with the limits of the API
 * checked on each field when leaving it and again on sending, where the focus
 * goes to the first problem. The price is typed in reais and sent in cents
 * (D90). On the demo, the name of a service is locked (RN28).
 */
export function ServiceForm({ service, isDemo, onSaved, onCancel }: ServiceFormProps) {
  const editing = service !== undefined
  const prefix = editing ? `servico-${service.id}` : 'servico-novo'
  const [draft, setDraft] = useState<ServiceDraft>(() => draftOf(service))
  const [touched, setTouched] = useState<Set<ServiceField>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [serverProblems, setServerProblems] = useState<ServiceProblems>({})
  const [failure, setFailure] = useState<unknown>(null)
  const create = useCreateService()
  const update = useUpdateService()
  const sending = useRef(false)
  const failureRef = useRef<HTMLDivElement>(null)
  const nameLocked = editing && isDemo
  const focusField = (field: ServiceField) => document.getElementById(`${prefix}-${field}`)?.focus()

  useEffect(() => {
    // A new service starts on its name; an edited one on the first field that can change.
    document.getElementById(`${prefix}-${nameLocked ? 'duration' : 'name'}`)?.focus()
  }, [nameLocked, prefix])
  useEffect(() => {
    if (failure !== null) failureRef.current?.focus()
  }, [failure])

  const problems = { ...problemsOf(draft), ...serverProblems }
  const shown = (field: ServiceField) =>
    showAll || touched.has(field) || serverProblems[field] !== undefined ? problems[field] : undefined

  const change = (field: ServiceField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setServerProblems((current) => {
      // Deleted, not set to `undefined`: the spread below would hide the local problem.
      const next = { ...current }
      delete next[field]
      return next
    })
    setFailure(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending.current) return
    const found = problemsOf(draft)
    const first = SERVICE_FIELDS.find((field) => found[field] !== undefined)
    if (first !== undefined) {
      setShowAll(true)
      focusField(first)
      return
    }
    const body = bodyOf(draft)
    if (editing) {
      const changes = changesOf(service, body)
      if (Object.keys(changes).length === 0) {
        onSaved({ kind: 'unchanged', service })
        return
      }
    }

    sending.current = true
    setFailure(null)
    try {
      const saved = editing
        ? await update.mutateAsync({ id: service.id, changes: changesOf(service, body) })
        : await create.mutateAsync(body)
      onSaved({ kind: editing ? 'saved' : 'created', service: saved })
    } catch (error) {
      const fromServer: ServiceProblems = {}
      if (error instanceof ApiError && error.status === 422) {
        for (const item of error.fieldErrors) {
          const field = SERVER_FIELDS[item.field]
          if (field !== undefined) fromServer[field] = serverText(field)
        }
      }
      const firstServer = SERVICE_FIELDS.find((field) => fromServer[field] !== undefined)
      if (firstServer !== undefined) {
        setServerProblems(fromServer)
        focusField(firstServer)
      } else {
        setFailure(error)
      }
    } finally {
      sending.current = false
    }
  }

  const busy = create.isPending || update.isPending
  const errorId = (field: ServiceField) => (shown(field) !== undefined ? `${prefix}-${field}-erro` : undefined)
  const describedBy = (field: ServiceField, hint?: string) =>
    [hint, errorId(field)].filter(Boolean).join(' ') || undefined
  const minutes = Number(draft.duration) + Number(draft.preparation)
  const blockHint =
    /^\d+$/.test(draft.duration.trim()) && /^\d+$/.test(draft.preparation.trim()) && minutes > 0
      ? `Cada agendamento ocupa ${formatDuration(minutes)} da agenda.`
      : 'Cada agendamento ocupa a duração mais o preparo.'

  const fieldShell = (field: ServiceField, control: ReactNode, hint?: ReactNode) => (
    <Field data-invalid={shown(field) !== undefined} className="gap-1.5">
      <FieldLabel htmlFor={`${prefix}-${field}`} className="text-[0.9375rem] text-foreground">
        {LABELS[field]}
      </FieldLabel>
      {control}
      {shown(field) !== undefined ? <FieldError id={errorId(field)}>{shown(field)}</FieldError> : null}
      {hint}
    </Field>
  )
  const inputProps = (field: ServiceField) => ({
    id: `${prefix}-${field}`,
    value: draft[field],
    readOnly: busy,
    'aria-invalid': shown(field) !== undefined,
    onChange: (event: ChangeEvent<HTMLInputElement>) => change(field, event.target.value),
    onBlur: () => setTouched((current) => new Set(current).add(field)),
  })
  const minutesField = (field: 'duration' | 'preparation', hintId?: string) => (
    <InputGroup className="h-11">
      <InputGroupInput
        {...inputProps(field)}
        inputMode="numeric"
        autoComplete="off"
        aria-describedby={describedBy(field, hintId)}
        className="text-base tabular-nums"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText className="text-[0.9375rem]">min</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  )

  return (
    <form
      noValidate
      aria-label={editing ? `Editar ${service.name}` : 'Novo serviço'}
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4"
    >
      {fieldShell(
        'name',
        <Input
          {...inputProps('name')}
          readOnly={busy || nameLocked}
          aria-readonly={nameLocked || undefined}
          autoComplete="off"
          aria-describedby={describedBy('name', nameLocked ? `${prefix}-name-trava` : undefined)}
          className="h-11 text-base read-only:aria-readonly:bg-muted read-only:aria-readonly:text-muted-foreground"
        />,
        nameLocked ? (
          <FieldDescription id={`${prefix}-name-trava`} className="flex items-start gap-1.5">
            <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Na demonstração, o nome dos serviços fica travado.
          </FieldDescription>
        ) : null,
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {fieldShell('duration', minutesField('duration', `${prefix}-bloco`))}
        {fieldShell('preparation', minutesField('preparation', `${prefix}-bloco`))}
        {fieldShell(
          'price',
          <InputGroup className="h-11">
            <InputGroupAddon>
              <InputGroupText className="text-[0.9375rem]">R$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              {...inputProps('price')}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              aria-describedby={describedBy('price')}
              className="text-base tabular-nums"
            />
          </InputGroup>,
        )}
      </div>
      <p id={`${prefix}-bloco`} className="-mt-1 text-sm text-muted-foreground">
        {blockHint} O preparo é o tempo depois do atendimento, antes do próximo cliente.
      </p>

      {failure !== null ? (
        <div ref={failureRef} tabIndex={-1}>
          <ErrorMessage
            error={failure}
            title={editing ? 'Não foi possível salvar o serviço' : 'Não foi possível criar o serviço'}
          />
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="lg" className="h-11 px-5 text-base" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="lg" className="h-11 px-5 text-base" disabled={busy}>
          {busy ? (
            <>
              <Spinner aria-hidden="true" />
              Salvando…
            </>
          ) : (
            <>
              <SaveIcon aria-hidden="true" className="size-5" />
              {editing ? 'Salvar serviço' : 'Criar serviço'}
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

/** The text of a field refused by the API, from the limits; never the message of Pydantic (D53). */
function serverText(field: ServiceField): string {
  switch (field) {
    case 'name':
      return `Use de 1 a ${SERVICE_LIMITS.nameMax} caracteres.`
    case 'duration':
      return `A duração vai de ${SERVICE_LIMITS.durationMin} a ${SERVICE_LIMITS.durationMax} minutos (24 horas).`
    case 'preparation':
      return `O preparo vai de 0 a ${SERVICE_LIMITS.preparationMax} minutos (24 horas).`
    case 'price':
      return 'O preço vai até R$ 1.000.000,00.'
  }
}
