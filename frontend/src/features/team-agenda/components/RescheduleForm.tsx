import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ApiError } from '@/api/errors'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toLocalDate, toUtcInstant } from '@/lib/datetime'

import { isFinalRefusal, refusalMessage, slotProblemMessage, slotRefusalOf } from '../messages'
import {
  findInAgendas,
  teamKeys,
  useRescheduleAppointment,
  type Professional,
  type StaffAppointment,
  type StaffChange,
} from '../queries'
import { checkSlot } from '../slot-check'
import { useSlotContext } from '../use-slot-context'
import { nameOf } from '../viewer'
import { SelectField } from './SelectField'
import { StaffTimeField } from './StaffTimeField'

export type RescheduleResult =
  | { kind: 'rescheduled'; change: StaffChange }
  /** `changed_meanwhile` (D83): the appointment was read again, and the reschedule closes. */
  | { kind: 'changed'; appointment: StaffAppointment | undefined; message: string }
  | { kind: 'refused'; error: unknown }

interface RescheduleFormProps {
  appointment: StaffAppointment
  /** Who may take it: the Owner chooses among those who do the service; empty keeps the current one. */
  candidates: Professional[]
  professionals: Professional[]
  timeZone: string
  today: string
  now: Date
  onDone: (result: RescheduleResult) => void
  onKeep: () => void
}

/**
 * UC17 without the deadline of the customer (RN20, D30): the same choice of
 * day and time as the manual appointment, in the sheet. It may overlap its
 * own current time. A `409` is told by its `reason` and keeps the choice open,
 * except `changed_meanwhile`, which reads the appointment again (D83).
 */
export function RescheduleForm({
  appointment,
  candidates,
  professionals,
  timeZone,
  today,
  now,
  onDone,
  onKeep,
}: RescheduleFormProps) {
  const queryClient = useQueryClient()
  const mutation = useRescheduleAppointment(appointment.id)
  const currentDay = toLocalDate(appointment.starts_at, timeZone)
  const [professionalId, setProfessionalId] = useState(appointment.professional_id)
  const [day, setDay] = useState(currentDay < today ? today : currentDay)
  const [time, setTime] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const timeRef = useRef<HTMLInputElement>(null)
  const sending = useRef(false)

  useEffect(() => timeRef.current?.focus(), [])

  const blockMinutes = appointment.duration_minutes + appointment.preparation_minutes
  const professionalName = nameOf(professionals, professionalId)
  const context = useSlotContext({
    professionalId,
    day,
    timeZone,
    now,
    blockMinutes,
    exceptId: appointment.id,
  })
  const check = checkSlot({ localDate: day, time, timeZone, now, working: context.working, blockMinutes })
  const problem =
    time === ''
      ? submitted
        ? 'Informe a hora, como 09:30.'
        : null
      : (touched || submitted) && !check.ok
        ? slotProblemMessage(check.problem, {
            professional: professionalName,
            working: context.working,
            durationMinutes: appointment.duration_minutes,
            preparationMinutes: appointment.preparation_minutes,
          })
        : null

  const reread = async () => {
    await queryClient.refetchQueries({ queryKey: teamKeys.agendaAll, type: 'active' })
    return findInAgendas(queryClient, appointment.id)
  }

  const send = async () => {
    setSubmitted(true)
    setRefusal(null)
    setFailure(null)
    const slot = checkSlot({ localDate: day, time, timeZone, now: new Date(), working: context.working, blockMinutes })
    if (!slot.ok) {
      timeRef.current?.focus()
      return
    }
    try {
      const change = await mutation.mutateAsync({
        starts_at: toUtcInstant(slot.instant),
        // Without a change of professional the field is left out, which keeps the current one.
        ...(professionalId !== appointment.professional_id ? { professional_id: professionalId } : {}),
      })
      onDone({ kind: 'rescheduled', change })
    } catch (error) {
      const reason = slotRefusalOf(error)
      if (reason === 'changed_meanwhile') {
        onDone({ kind: 'changed', appointment: await reread(), message: refusalMessage(reason, professionalName) })
        return
      }
      if (reason !== undefined) {
        void queryClient.invalidateQueries({ queryKey: teamKeys.timeBlocks(professionalId) })
        setRefusal(refusalMessage(reason, professionalName))
        timeRef.current?.focus()
        return
      }
      if (isFinalRefusal(error)) {
        await reread()
        onDone({ kind: 'refused', error })
        return
      }
      if (error instanceof ApiError && error.status === 422) {
        void queryClient.invalidateQueries({ queryKey: teamKeys.services })
        void queryClient.invalidateQueries({ queryKey: teamKeys.professionals })
      }
      setFailure(error)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current) return
    sending.current = true
    void send().finally(() => {
      sending.current = false
    })
  }

  const busy = mutation.isPending
  const options = candidates.some((item) => item.id === appointment.professional_id)
    ? candidates
    : [...professionals.filter((item) => item.id === appointment.professional_id), ...candidates]

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-label="Remarcar">
      <h3 className="text-lg font-semibold">Novo horário</h3>
      {options.length > 1 ? (
        <SelectField
          id="remarcar-profissional"
          label="Profissional"
          placeholder="Escolha o profissional"
          value={professionalId}
          onValueChange={(next) => {
            setProfessionalId(next)
            setRefusal(null)
          }}
          options={options.map((item) => ({ value: item.id, label: item.name }))}
          disabled={busy}
        />
      ) : null}
      <StaffTimeField
        idPrefix="remarcar"
        day={day}
        onDayChange={(next) => {
          setDay(next)
          setRefusal(null)
        }}
        time={time}
        onTimeChange={(next) => {
          setTime(next)
          setRefusal(null)
        }}
        onTimeBlur={() => setTouched(true)}
        today={today}
        timeZone={timeZone}
        professionalName={professionalName}
        blockMinutes={blockMinutes}
        context={context}
        problem={problem}
        refusal={refusal}
        disabled={busy}
        timeRef={timeRef}
      />
      {failure !== null ? <ErrorMessage error={failure} title="Não foi possível remarcar" /> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 px-5 text-base"
          disabled={busy}
          onClick={onKeep}
        >
          Manter horário atual
        </Button>
        <Button type="submit" size="lg" className="h-11 px-5 text-base" disabled={busy}>
          {busy ? (
            <>
              <Spinner aria-hidden="true" />
              Remarcando…
            </>
          ) : check.ok ? (
            `Remarcar para ${time}`
          ) : (
            'Remarcar'
          )}
        </Button>
      </div>
    </form>
  )
}
