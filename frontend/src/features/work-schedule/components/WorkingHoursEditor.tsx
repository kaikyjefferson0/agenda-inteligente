import { useQuery } from '@tanstack/react-query'
import { CalendarClockIcon, CheckIcon, CircleAlertIcon, SaveIcon } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { workingHoursQuery, type Professional, type WorkingInterval } from '@/features/scheduling'

import { useSaveWorkingHours, type WorkingHoursUpdate } from '../queries'
import {
  addInterval,
  changeInterval,
  copyDay,
  draftOf,
  fieldId,
  intervalsOf,
  problemsOf,
  removeInterval,
  sameWeek,
  WEEKDAYS,
  type WeekDraft,
} from '../week-draft'
import { AppointmentLinks } from './AppointmentLinks'
import { DayEditor } from './DayEditor'

interface WorkingHoursEditorProps {
  professional: Professional
  timeZone: string
  isOwner: boolean
  onDirtyChange: (dirty: boolean) => void
}

/** UC08: reads the week of the professional, then edits it. */
export function WorkingHoursEditor(props: WorkingHoursEditorProps) {
  const hours = useQuery(workingHoursQuery(props.professional.id))
  if (hours.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-hidden="true">
        {WEEKDAYS.map((day) => (
          <Skeleton key={day} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    )
  }
  if (hours.isError) {
    return (
      <ErrorMessage
        error={hours.error}
        title="Não foi possível carregar o expediente"
        onRetry={() => void hours.refetch()}
      />
    )
  }
  return <WeekForm {...props} saved={hours.data.intervals} />
}

interface WeekFormProps extends WorkingHoursEditorProps {
  /** The week as the API has it. */
  saved: WorkingInterval[]
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * The seven days in one form. What the API would refuse (an end not after
 * the start, overlapping intervals) is told on the field before sending; the
 * `PUT` then replaces the whole week. The answer says which future
 * appointments are now outside the hours: they stay booked (RN22).
 */
function WeekForm({ professional, timeZone, isOwner, onDirtyChange, saved }: WeekFormProps) {
  const [draft, setDraft] = useState<WeekDraft>(() => draftOf(saved))
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [result, setResult] = useState<WorkingHoursUpdate | null>(null)
  const [copied, setCopied] = useState('')
  const mutation = useSaveWorkingHours(professional.id)
  const sending = useRef(false)
  const summary = useRef<HTMLElement>(null)
  const notice = useRef<HTMLDivElement>(null)

  const dirty = !sameWeek(draft, draftOf(saved))
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => {
    if (result !== null) notice.current?.focus()
  }, [result])

  const problems = problemsOf(draft)
  const shown = problems.filter((problem) => showAll || touched.has(`${problem.key}:${problem.field}`))

  const edit = (next: WeekDraft) => {
    setDraft(next)
    setCopied('')
    // The notice of the last save no longer describes the form, except the appointments it left out.
    setResult((current) => (current !== null && current.appointments_outside_hours.length > 0 ? current : null))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending.current) return
    if (problems.length > 0) {
      setShowAll(true)
      requestAnimationFrame(() => summary.current?.focus())
      return
    }
    sending.current = true
    try {
      const answer = await mutation.mutateAsync(intervalsOf(draft))
      setDraft(draftOf(answer.intervals))
      setTouched(new Set())
      setShowAll(false)
      setResult(answer)
    } catch {
      // The error is shown below the form, from `mutation.error`.
    } finally {
      sending.current = false
    }
  }

  const busy = mutation.isPending
  const outside = result?.appointments_outside_hours ?? []

  return (
    <div className="flex flex-col gap-6">
      {result !== null ? (
        outside.length > 0 ? (
          <div ref={notice} tabIndex={-1} className="flex flex-col gap-3">
            <Alert>
              <CalendarClockIcon aria-hidden="true" />
              <AlertTitle>
                Expediente salvo. {plural(outside.length, 'agendamento ficou', 'agendamentos ficaram')} fora dele
              </AlertTitle>
              <AlertDescription>
                <p>
                  {outside.length === 1 ? 'Ele continua marcado' : 'Eles continuam marcados'}: o novo expediente vale
                  para as próximas reservas. Se o profissional não for atender nesses horários, remarque ou cancele
                  pela agenda e avise o cliente.
                </p>
              </AlertDescription>
            </Alert>
            <AppointmentLinks
              appointments={outside}
              timeZone={timeZone}
              filterByProfessional={isOwner}
              label="Agendamentos fora do novo expediente"
            />
          </div>
        ) : (
          <div
            ref={notice}
            tabIndex={-1}
            className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
            role="status"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
              <CheckIcon aria-hidden="true" className="size-4" strokeWidth={2.5} />
            </span>
            <p className="font-medium">Expediente salvo. Nenhum agendamento ficou fora dele.</p>
          </div>
        )
      ) : null}

      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" aria-label="Expediente semanal">
        {showAll && problems.length > 0 ? (
          <section ref={summary} tabIndex={-1} aria-labelledby="expediente-problemas">
            <Alert variant="destructive">
              <CircleAlertIcon aria-hidden="true" />
              <AlertTitle id="expediente-problemas">
                {problems.length === 1 ? 'Corrija um horário antes de salvar' : `Corrija ${problems.length} horários antes de salvar`}
              </AlertTitle>
              <AlertDescription>
                <ul className="flex flex-col gap-1">
                  {problems.map((problem) => (
                    <li key={`${problem.key}:${problem.field}`}>
                      <a
                        href={`#${fieldId(problem.key, problem.field)}`}
                        className="text-destructive underline underline-offset-2"
                        onClick={(event) => {
                          event.preventDefault()
                          document.getElementById(fieldId(problem.key, problem.field))?.focus()
                        }}
                      >
                        {WEEKDAYS[problem.weekday]}: {problem.message}
                      </a>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          </section>
        ) : null}

        <h2 className="sr-only">Dias da semana</h2>
        <ol className="flex flex-col divide-y rounded-xl border bg-card">
          {draft.map((intervals, weekday) => (
            <DayEditor
              key={WEEKDAYS[weekday]}
              weekday={weekday}
              intervals={intervals}
              problems={shown.filter((problem) => problem.weekday === weekday)}
              disabled={busy}
              onAdd={() => edit(addInterval(draft, weekday))}
              onRemove={(key) => edit(removeInterval(draft, weekday, key))}
              onChange={(key, change) => edit(changeInterval(draft, weekday, key, change))}
              onBlurField={(key, field) => setTouched((current) => new Set(current).add(`${key}:${field}`))}
              onCopy={(targets) => {
                edit(copyDay(draft, weekday, targets))
                const names = [...targets]
                  .sort((a, b) => a - b)
                  .map((index) => WEEKDAYS[index].toLocaleLowerCase('pt-BR'))
                setCopied(
                  `Expediente de ${WEEKDAYS[weekday].toLocaleLowerCase('pt-BR')} copiado para ${
                    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`
                  }. Salve para valer.`,
                )
              }}
            />
          ))}
        </ol>

        {mutation.isError ? <ErrorMessage error={mutation.error} title="Não foi possível salvar o expediente" /> : null}

        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:-mx-6 lg:px-6">
          <p className="min-w-0 text-sm text-muted-foreground" aria-live="polite">
            {copied !== '' ? copied : dirty ? 'Alterações não salvas.' : 'Nenhuma alteração.'}
          </p>
          <Button type="submit" size="lg" className="h-11 shrink-0 px-5 text-base" disabled={busy || !dirty}>
            {busy ? (
              <>
                <Spinner aria-hidden="true" />
                Salvando…
              </>
            ) : (
              <>
                <SaveIcon aria-hidden="true" className="size-5" />
                Salvar expediente
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
