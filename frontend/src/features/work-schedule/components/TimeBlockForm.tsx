import { useQueryClient } from '@tanstack/react-query'
import { CalendarOffIcon, CircleAlertIcon } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ApiError } from '@/api/errors'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import {
  AppointmentLinks,
  conflictsOf,
  teamKeys,
  type ScheduledAppointment,
  type TimeBlock,
} from '@/features/scheduling'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'

import {
  blockPeriodOf,
  describeBlock,
  overlappingBlocks,
  type BlockField,
  type BlockInput,
} from '../block-period'
import { useCreateTimeBlock } from '../queries'

const REASON_MAX = 500

interface TimeBlockFormProps {
  professionalId: string
  timeZone: string
  today: string
  /** Every block of the professional, as last read: an overlap is told before sending. */
  blocks: TimeBlock[]
  isOwner: boolean
  onCreated: (block: TimeBlock) => void
}

type Refusal =
  | { kind: 'overlap'; blocks: TimeBlock[] }
  | { kind: 'conflicts'; appointments: ScheduledAppointment[] }
  | { kind: 'error'; error: unknown }

/**
 * UC09, creating: start, end and reason, in the clock of the business (D56,
 * RN06), with "Dia inteiro" for a day off. Before sending, the period and the
 * reason are checked, and so is an overlap with a block already listed. The
 * API decides under lock (RN14): a block on top of another, or of appointments
 * (RN21, with the list), is explained above the button, and what was typed
 * stays.
 */
export function TimeBlockForm({ professionalId, timeZone, today, blocks, isOwner, onCreated }: TimeBlockFormProps) {
  const [input, setInput] = useState<BlockInput>({
    allDay: false,
    startDay: today,
    startTime: '',
    endDay: today,
    endTime: '',
  })
  const [reason, setReason] = useState('')
  // The reason or an hour typed; the days alone, which start on today, are not work to lose.
  useUnsavedChanges(reason.trim() !== '' || input.startTime !== '' || input.endTime !== '')
  const [problems, setProblems] = useState<Partial<Record<BlockField | 'reason', string>>>({})
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const mutation = useCreateTimeBlock(professionalId)
  const queryClient = useQueryClient()
  const sending = useRef(false)
  const refusalRef = useRef<HTMLDivElement>(null)
  const fields = useRef<Partial<Record<BlockField | 'reason', HTMLElement | null>>>({})

  useEffect(() => {
    if (refusal !== null) refusalRef.current?.focus()
  }, [refusal])

  const change = (next: Partial<BlockInput>) => {
    setInput((current) => {
      const merged = { ...current, ...next }
      // Moving the start day carries the end day along while it was the same or earlier.
      if (next.startDay !== undefined && (current.endDay === current.startDay || merged.endDay < merged.startDay)) {
        merged.endDay = next.startDay
      }
      return merged
    })
    setProblems({})
    setRefusal(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending.current) return
    setRefusal(null)
    const period = blockPeriodOf(input, timeZone)
    const found: Partial<Record<BlockField | 'reason', string>> =
      period.kind === 'invalid' ? { ...period.problems } : {}
    const text = reason.trim()
    if (text === '') found.reason = 'Informe o motivo, como “Folga” ou “Consulta médica”.'
    else if ([...text].length > REASON_MAX) found.reason = `Use até ${REASON_MAX} caracteres.`
    const order: (BlockField | 'reason')[] = ['startDay', 'startTime', 'endDay', 'endTime', 'reason']
    const first = order.find((field) => found[field] !== undefined)
    setProblems(found)
    if (first !== undefined || period.kind !== 'ok') {
      if (first !== undefined) fields.current[first]?.focus()
      return
    }

    const overlapping = overlappingBlocks(blocks, period.startsAt, period.endsAt)
    if (overlapping.length > 0) {
      setRefusal({ kind: 'overlap', blocks: overlapping })
      return
    }

    sending.current = true
    try {
      const created = await mutation.mutateAsync({ starts_at: period.startsAt, ends_at: period.endsAt, reason: text })
      setReason('')
      setInput((current) => ({ ...current, startTime: '', endTime: '' }))
      onCreated(created)
    } catch (error) {
      const conflicts = conflictsOf(error)
      if (conflicts !== null) setRefusal({ kind: 'conflicts', appointments: conflicts })
      else if (error instanceof ApiError && error.code === 'TIME_BLOCK_OVERLAP') {
        // The list on the screen was old: read it again to show which block is in the way.
        await queryClient.refetchQueries({ queryKey: teamKeys.timeBlocks(professionalId), type: 'active' })
        const fresh = queryClient.getQueryData<TimeBlock[]>(teamKeys.timeBlocks(professionalId)) ?? []
        setRefusal({ kind: 'overlap', blocks: overlappingBlocks(fresh, period.startsAt, period.endsAt) })
      } else setRefusal({ kind: 'error', error })
    } finally {
      sending.current = false
    }
  }

  const busy = mutation.isPending
  const errorId = (field: BlockField | 'reason') => (problems[field] !== undefined ? `bloqueio-${field}-erro` : undefined)
  const dateField = (field: 'startDay' | 'endDay', label: string, min?: string): ReactNode => (
    <Field data-invalid={problems[field] !== undefined} className="gap-1.5">
      <FieldLabel htmlFor={`bloqueio-${field}`} className="text-[0.9375rem] text-foreground">
        {label}
      </FieldLabel>
      <Input
        ref={(element) => {
          fields.current[field] = element
        }}
        id={`bloqueio-${field}`}
        type="date"
        min={min}
        value={input[field]}
        readOnly={busy}
        aria-invalid={problems[field] !== undefined}
        aria-describedby={errorId(field)}
        onChange={(event) => change({ [field]: event.target.value })}
        className="h-11 text-base tabular-nums"
      />
    </Field>
  )
  const timeField = (field: 'startTime' | 'endTime', label: string): ReactNode => (
      <Field data-invalid={problems[field] !== undefined} className="gap-1.5">
        <FieldLabel htmlFor={`bloqueio-${field}`} className="text-[0.9375rem] text-foreground">
          {label}
        </FieldLabel>
        <Input
          ref={(element) => {
            fields.current[field] = element
          }}
          id={`bloqueio-${field}`}
          type="time"
          value={input[field]}
          readOnly={busy}
          aria-invalid={problems[field] !== undefined}
          aria-describedby={errorId(field)}
          onChange={(event) => change({ [field]: event.target.value })}
          className="h-11 text-base tabular-nums"
        />
      </Field>
    )
  const errorsOf = (...list: (BlockField | 'reason')[]) =>
    list.map((field) =>
      problems[field] !== undefined ? (
        <FieldError key={field} id={errorId(field)}>
          {problems[field]}
        </FieldError>
      ) : null,
    )

  return (
    <form
      noValidate
      aria-labelledby="novo-bloqueio-titulo"
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <h2 id="novo-bloqueio-titulo" className="text-lg font-semibold">
        Novo bloqueio
      </h2>

      <label
        htmlFor="bloqueio-dia-inteiro"
        className="flex min-h-11 cursor-pointer items-center gap-3 self-start rounded-lg border bg-background px-3 text-[0.9375rem] transition-colors duration-(--duration-fast) hover:bg-accent/60 has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-accent has-[[aria-checked=true]]:text-accent-foreground"
      >
        <Checkbox
          id="bloqueio-dia-inteiro"
          checked={input.allDay}
          disabled={busy}
          onCheckedChange={(next) => change({ allDay: next === true })}
        />
        Dia inteiro
      </label>

      {input.allDay ? (
        // A day off: the two days side by side, no times.
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-3">
            {dateField('startDay', 'Primeiro dia')}
            {dateField('endDay', 'Último dia', input.startDay)}
          </div>
          {errorsOf('startDay', 'endDay')}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-3">
              {dateField('startDay', 'Início')}
              {timeField('startTime', 'Hora do início')}
            </div>
            {errorsOf('startDay', 'startTime')}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-3">
              {dateField('endDay', 'Fim', input.startDay)}
              {timeField('endTime', 'Hora do fim')}
            </div>
            {errorsOf('endDay', 'endTime')}
          </div>
        </>
      )}

      <Field data-invalid={problems.reason !== undefined} className="gap-1.5">
        <FieldLabel htmlFor="bloqueio-reason" className="text-[0.9375rem] text-foreground">
          Motivo
        </FieldLabel>
        <Textarea
          ref={(element) => {
            fields.current.reason = element
          }}
          id="bloqueio-reason"
          rows={2}
          value={reason}
          readOnly={busy}
          aria-invalid={problems.reason !== undefined}
          aria-describedby={['bloqueio-reason-dica', errorId('reason')].filter(Boolean).join(' ')}
          onChange={(event) => {
            setReason(event.target.value)
            setProblems((current) => ({ ...current, reason: undefined }))
          }}
          className="min-h-11 text-base"
        />
        {errorsOf('reason')}
        <FieldDescription id="bloqueio-reason-dica">
          Só a equipe vê o motivo. {[...reason].length}/{REASON_MAX}
        </FieldDescription>
      </Field>

      {refusal !== null ? (
        <div ref={refusalRef} tabIndex={-1} className="flex flex-col gap-3">
          <RefusalMessage refusal={refusal} timeZone={timeZone} isOwner={isOwner} />
        </div>
      ) : null}

      <Button type="submit" size="lg" className="h-11 self-stretch px-5 text-base sm:self-start" disabled={busy}>
        {busy ? (
          <>
            <Spinner aria-hidden="true" />
            Bloqueando…
          </>
        ) : (
          <>
            <CalendarOffIcon aria-hidden="true" className="size-5" />
            Bloquear horário
          </>
        )}
      </Button>
    </form>
  )
}

function RefusalMessage({ refusal, timeZone, isOwner }: { refusal: Refusal; timeZone: string; isOwner: boolean }) {
  if (refusal.kind === 'error') return <ErrorMessage error={refusal.error} title="Não foi possível bloquear" />
  if (refusal.kind === 'overlap') {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>Já existe um bloqueio nesse período</AlertTitle>
        <AlertDescription>
          <p>
            Dois bloqueios não podem se sobrepor. Ajuste o início ou o fim, ou remova o bloqueio abaixo e crie um só
            com o período inteiro.
          </p>
          {refusal.blocks.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-0.5">
              {refusal.blocks.map((block) => {
                const when = describeBlock(block, timeZone)
                return (
                  <li key={block.id} className="text-foreground">
                    <span className="inline-block first-letter:uppercase">{when.days}</span>,{' '}
                    <span className="tabular-nums">{when.hours.toLocaleLowerCase('pt-BR')}</span>: {block.reason}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </AlertDescription>
      </Alert>
    )
  }
  const count = refusal.appointments.length
  return (
    <>
      <Alert variant="destructive">
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>
          {count === 1 ? 'Há um agendamento nesse período' : `Há ${count} agendamentos nesse período`}
        </AlertTitle>
        <AlertDescription>
          <p>
            O bloqueio não foi criado, porque não pode ficar sobre agendamentos. Remarque ou cancele{' '}
            {count === 1 ? 'o agendamento' : 'cada um'} pela agenda e tente de novo: o que você preencheu continua
            aqui.
          </p>
        </AlertDescription>
      </Alert>
      <AppointmentLinks
        appointments={refusal.appointments}
        timeZone={timeZone}
        filterByProfessional={isOwner}
        label="Agendamentos em conflito com o bloqueio"
      />
    </>
  )
}
