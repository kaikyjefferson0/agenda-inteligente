import { CircleAlertIcon } from 'lucide-react'
import type { Ref } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMinutes } from '@/lib/datetime'
import { formatDuration } from '@/lib/format'
import { timeZoneName } from '@/lib/timezone-name'

import { formatRanges } from '../slot-check'
import type { SlotContext } from '../use-slot-context'

interface StaffTimeFieldProps {
  idPrefix: string
  day: string
  onDayChange: (day: string) => void
  time: string
  onTimeChange: (time: string) => void
  onTimeBlur?: () => void
  today: string
  timeZone: string
  professionalName: string
  /** Service plus preparation, for the text of a day with no room. */
  blockMinutes: number
  context: SlotContext
  /** Below the fields: a day or time that cannot be sent (D82). */
  problem: string | null
  /** A `409` explained by its `reason` (D83). */
  refusal: string | null
  disabled?: boolean
  timeRef?: Ref<HTMLInputElement>
}

/**
 * Day and time for the team (UC16, UC17): any exact minute, off the grid
 * (RN19). Below, the working hours of the day and the free ranges where the
 * whole block fits; a range fills the time with its start.
 */
export function StaffTimeField({
  idPrefix,
  day,
  onDayChange,
  time,
  onTimeChange,
  onTimeBlur,
  today,
  timeZone,
  professionalName,
  blockMinutes,
  context,
  problem,
  refusal,
  disabled = false,
  timeRef,
}: StaffTimeFieldProps) {
  const dayId = `${idPrefix}-dia`
  const timeId = `${idPrefix}-hora`
  const problemId = `${idPrefix}-hora-erro`
  const helpId = `${idPrefix}-hora-ajuda`
  const invalid = problem !== null || refusal !== null

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field className="gap-1.5">
          <FieldLabel htmlFor={dayId} className="text-[0.9375rem] text-foreground">
            Dia
          </FieldLabel>
          <Input
            id={dayId}
            type="date"
            min={today}
            value={day}
            onChange={(event) => onDayChange(event.target.value)}
            readOnly={disabled}
            className="h-11 text-base tabular-nums"
          />
        </Field>
        <Field data-invalid={invalid} className="gap-1.5">
          <FieldLabel htmlFor={timeId} className="text-[0.9375rem] text-foreground">
            Hora
          </FieldLabel>
          <Input
            ref={timeRef}
            id={timeId}
            type="time"
            step={60}
            value={time}
            onChange={(event) => onTimeChange(event.target.value)}
            onBlur={onTimeBlur}
            aria-invalid={invalid}
            aria-describedby={[problem !== null ? problemId : '', helpId].filter(Boolean).join(' ')}
            readOnly={disabled}
            className="h-11 text-base tabular-nums"
          />
        </Field>
      </div>
      {problem !== null ? <FieldError id={problemId}>{problem}</FieldError> : null}
      {refusal !== null ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription className="text-destructive">{refusal}</AlertDescription>
        </Alert>
      ) : null}

      <div id={helpId} className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>Horário no fuso do negócio ({timeZoneName(timeZone)}), em qualquer minuto.</p>
        {context.loading ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <span className="sr-only">Carregando o expediente…</span>
            <Skeleton className="h-4 w-56" />
            <div className="flex gap-2">
              <Skeleton className="h-11 w-28 rounded-full md:h-9" />
              <Skeleton className="h-11 w-28 rounded-full md:h-9" />
            </div>
          </div>
        ) : context.error !== null ? (
          <p className="flex flex-wrap items-center gap-x-2">
            Não foi possível carregar o expediente.
            <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={context.retry}>
              Tentar de novo
            </Button>
          </p>
        ) : context.working !== undefined ? (
          context.working.length === 0 ? (
            <p>{professionalName} não tem expediente neste dia.</p>
          ) : (
            <>
              <p>
                Expediente de {professionalName}:{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {formatRanges(context.working)}
                </span>
              </p>
              {day < today ? null : blockMinutes === 0 ? (
                <p>Escolha o serviço para ver as faixas livres.</p>
              ) : context.free !== undefined && context.free.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <p id={`${idPrefix}-livres`}>Faixas livres para {formatDuration(blockMinutes)}, com o preparo:</p>
                  <ul aria-labelledby={`${idPrefix}-livres`} className="flex flex-wrap gap-2">
                    {context.free.map((range) => (
                      <li key={range.start}>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={disabled}
                          aria-label={`Usar ${formatMinutes(range.start)}, livre até ${formatMinutes(range.end)}`}
                          className="h-11 rounded-full px-3.5 text-sm tabular-nums md:h-9"
                          onClick={() => onTimeChange(formatMinutes(range.start))}
                        >
                          {formatMinutes(range.start)}–{formatMinutes(range.end)}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : context.free !== undefined ? (
                <p>Nenhuma faixa livre de {formatDuration(blockMinutes)} neste dia.</p>
              ) : null}
            </>
          )
        ) : null}
      </div>
    </div>
  )
}
