import { CopyIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'

import { daySummary, fieldId, SHORT_WEEKDAYS, WEEKDAYS, type DraftInterval, type IntervalProblem } from '../week-draft'

interface DayEditorProps {
  weekday: number
  intervals: DraftInterval[]
  /** The problems shown on this day: after a blur of the field, or after a failed save. */
  problems: IntervalProblem[]
  disabled: boolean
  onAdd: () => void
  onRemove: (key: string) => void
  onChange: (key: string, change: Partial<Pick<DraftInterval, 'start' | 'end'>>) => void
  onBlurField: (key: string, field: 'start' | 'end') => void
  onCopy: (targets: number[]) => void
}

const lower = (weekday: number) => WEEKDAYS[weekday].toLocaleLowerCase('pt-BR')

/**
 * One day of the week (UC08): its intervals in native time fields, 44 px
 * high; adding one; removing one; and copying the day to others, inline
 * rather than in a modal, with a large target per day.
 */
export function DayEditor({
  weekday,
  intervals,
  problems,
  disabled,
  onAdd,
  onRemove,
  onChange,
  onBlurField,
  onCopy,
}: DayEditorProps) {
  const id = useId()
  const [copying, setCopying] = useState(false)
  const [targets, setTargets] = useState<number[]>([])
  const copyButton = useRef<HTMLButtonElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const name = WEEKDAYS[weekday]
  const others = WEEKDAYS.map((_, index) => index).filter((index) => index !== weekday)
  const closed = intervals.length === 0

  const closeCopy = () => {
    setCopying(false)
    setTargets([])
    copyButton.current?.focus()
  }

  const remove = (index: number, key: string) => {
    onRemove(key)
    // The focus would be lost with the button: it goes to the interval above, or to "Adicionar".
    const previous = intervals[index - 1] ?? intervals[index + 1]
    requestAnimationFrame(() => {
      const target =
        previous !== undefined && previous.key !== key ? document.getElementById(fieldId(previous.key, 'start')) : null
      ;(target ?? addButton.current)?.focus()
    })
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-4" aria-labelledby={`${id}-dia`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h3 id={`${id}-dia`} className="text-[1.0625rem] leading-tight font-semibold">
            {name}
          </h3>
          <p className="text-sm text-muted-foreground tabular-nums">
            <NoBreakRanges text={daySummary(intervals)} />
          </p>
        </div>
        <Button
          ref={copyButton}
          type="button"
          variant="ghost"
          className="h-11 shrink-0 px-3 text-[0.9375rem] md:h-9"
          aria-expanded={copying}
          aria-controls={`${id}-copiar`}
          disabled={disabled}
          onClick={() => (copying ? closeCopy() : setCopying(true))}
        >
          <CopyIcon aria-hidden="true" />
          Copiar para…
        </Button>
      </div>

      {intervals.length > 0 ? (
        <ul aria-label={`Intervalos de ${lower(weekday)}`} className="flex flex-col gap-2">
          {intervals.map((interval, index) => {
            const problemOf = (field: 'start' | 'end') =>
              problems.find((problem) => problem.key === interval.key && problem.field === field)
            const startProblem = problemOf('start')
            const endProblem = problemOf('end')
            const errorId = `${interval.key}-erro`
            const label = `intervalo ${index + 1} de ${lower(weekday)}`
            return (
              <li key={interval.key} className="flex flex-col gap-1">
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 sm:max-w-md">
                  <Input
                    id={fieldId(interval.key, 'start')}
                    type="time"
                    aria-label={`Início do ${label}`}
                    value={interval.start}
                    required
                    readOnly={disabled}
                    aria-invalid={startProblem !== undefined}
                    aria-describedby={startProblem !== undefined ? errorId : undefined}
                    onChange={(event) => onChange(interval.key, { start: event.target.value })}
                    onBlur={() => onBlurField(interval.key, 'start')}
                    className="h-11 text-base tabular-nums"
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    até
                  </span>
                  <Input
                    id={fieldId(interval.key, 'end')}
                    type="time"
                    aria-label={`Fim do ${label}`}
                    value={interval.end}
                    required
                    readOnly={disabled}
                    aria-invalid={endProblem !== undefined}
                    aria-describedby={endProblem !== undefined ? errorId : undefined}
                    onChange={(event) => onChange(interval.key, { end: event.target.value })}
                    onBlur={() => onBlurField(interval.key, 'end')}
                    className="h-11 text-base tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 text-muted-foreground hover:text-destructive"
                    aria-label={`Remover ${label}`}
                    disabled={disabled}
                    onClick={() => remove(index, interval.key)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
                {startProblem !== undefined || endProblem !== undefined ? (
                  <p id={errorId} className="text-sm text-destructive">
                    {[startProblem?.message, endProblem?.message].filter(Boolean).join(' ')}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      <Button
        ref={addButton}
        type="button"
        variant="outline"
        className="h-11 self-start px-3 text-[0.9375rem] md:h-9"
        disabled={disabled}
        aria-label={`${closed ? 'Abrir este dia' : 'Adicionar intervalo'}: ${lower(weekday)}`}
        onClick={onAdd}
      >
        <PlusIcon aria-hidden="true" />
        {closed ? 'Abrir este dia' : 'Adicionar intervalo'}
      </Button>

      {copying ? (
        <fieldset
          id={`${id}-copiar`}
          aria-labelledby={`${id}-copiar-titulo`}
          className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-3"
        >
          <p id={`${id}-copiar-titulo`} className="text-[0.9375rem] text-pretty">
            {closed ? (
              <>Deixar também fechados, como {lower(weekday)}:</>
            ) : (
              <>
                Copiar{' '}
                <span className="font-medium tabular-nums">
                  <NoBreakRanges text={daySummary(intervals)} />
                </span>{' '}
                de{' '}
                {lower(weekday)} para:
              </>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {others.map((index) => {
              const checkboxId = `${id}-copiar-${index}`
              const checked = targets.includes(index)
              return (
                <label
                  key={index}
                  htmlFor={checkboxId}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 whitespace-nowrap text-[0.9375rem] transition-colors duration-(--duration-fast) hover:bg-accent/60 has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-accent has-[[aria-checked=true]]:text-accent-foreground"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    onCheckedChange={(next) =>
                      setTargets((current) =>
                        next === true ? [...current, index] : current.filter((item) => item !== index),
                      )
                    }
                  />
                  {SHORT_WEEKDAYS[index]}
                </label>
              )
            })}
          </div>
          <p className="text-sm text-muted-foreground">Os intervalos dos dias marcados são substituídos.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-11 px-4 text-[0.9375rem] md:h-9"
              disabled={targets.length === 0}
              onClick={() => {
                onCopy(targets)
                closeCopy()
              }}
            >
              <CopyIcon aria-hidden="true" />
              {targets.length === 0
                ? 'Copiar'
                : `Copiar para ${targets.length} ${targets.length === 1 ? 'dia' : 'dias'}`}
            </Button>
            <Button type="button" variant="ghost" className="h-11 px-4 text-[0.9375rem] md:h-9" onClick={closeCopy}>
              Cancelar
            </Button>
          </div>
        </fieldset>
      ) : null}
    </li>
  )
}

/** `09:00–12:00 e 13:00–19:00`, wrapping between the ranges, never inside one. */
function NoBreakRanges({ text }: { text: string }) {
  return text.split(/(\d{2}:\d{2}–\d{2}:\d{2})/).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  )
}
