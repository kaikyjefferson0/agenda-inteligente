import { CalendarX2Icon, CheckIcon, ChevronRightIcon } from 'lucide-react'
import { useId, useRef, type ReactNode } from 'react'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { formatLocalDate, formatTime, localHour } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { timeZoneName } from '@/lib/timezone-name'

import { targetIndex } from '../radio-keys'
import { DayStrip, type DayStripHandle } from './DayStrip'

/**
 * Choice of day and time (D58: the highlight component that comes from
 * Magic). Adapted from "Time Slot Picker" (21st.dev, klyv-ui, id 43217): two
 * keyboard-navigable radio groups, the day only narrows the grid and the time
 * is the value. Changed here: every date and time comes from
 * `src/lib/datetime.ts` in the time zone of the business (D56), never the
 * browser's; the slots of each day are loaded when the day is chosen; the
 * times are grouped by period of the day; colors are the project tokens, and
 * every target is at least 44 px (D55).
 */

export interface Slot {
  starts_at: string
}

interface DateTimePickerProps {
  timeZone: string
  /** Days open for booking, in order (`YYYY-MM-DD`, local to the business). */
  days: string[]
  today: string
  day: string
  onDayChange: (day: string) => void
  /** Slots of `day`; `undefined` while loading or after an error. */
  slots: Slot[] | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  value: string | null
  onValueChange: (startsAt: string) => void
  maxAdvanceDays: number
  /** Shown above the times, such as the slot taken in the meantime (409). */
  notice?: ReactNode
}

const PERIODS = [
  { id: 'manha', label: 'Manhã', from: 0, to: 12 },
  { id: 'tarde', label: 'Tarde', from: 12, to: 18 },
  { id: 'noite', label: 'Noite', from: 18, to: 24 },
] as const

export function DateTimePicker({
  timeZone,
  days,
  today,
  day,
  onDayChange,
  slots,
  loading,
  error,
  onRetry,
  value,
  onValueChange,
  maxAdvanceDays,
  notice,
}: DateTimePickerProps) {
  const uid = useId()
  const strip = useRef<DayStripHandle>(null)
  const dayIndex = Math.max(0, days.indexOf(day))
  const nextDay = days[dayIndex + 1]

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <DayStrip ref={strip} days={days} today={today} value={day} onValueChange={onDayChange} />

      <div className="flex flex-col gap-4">
        <h3 id={`${uid}-day`} className="text-lg leading-snug font-semibold first-letter:uppercase">
          {formatLocalDate(day)}
        </h3>

        {notice}

        {loading ? (
          <div aria-busy="true" className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4 sm:grid-cols-5">
            <span className="sr-only">Carregando horários…</span>
            {Array.from({ length: 10 }, (_, index) => (
              <Skeleton key={index} className="h-11 rounded-full" />
            ))}
          </div>
        ) : error !== null && error !== undefined ? (
          <ErrorMessage
            error={error}
            title="Não foi possível carregar os horários"
            onRetry={onRetry}
          />
        ) : slots === undefined || slots.length === 0 ? (
          <Empty className="border border-dashed bg-card/50 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarX2Icon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-base font-semibold">Sem horários livres neste dia</EmptyTitle>
              <EmptyDescription>
                {nextDay !== undefined
                  ? 'Pode estar lotado, fechado ou perto demais de agora. Tente outro dia.'
                  : `As reservas abrem com até ${maxAdvanceDays} dias de antecedência. Escolha um dia anterior.`}
              </EmptyDescription>
            </EmptyHeader>
            {nextDay !== undefined ? (
              <EmptyContent>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 px-4 text-[0.9375rem]"
                  onClick={() => {
                    onDayChange(nextDay)
                    strip.current?.focusDay(nextDay)
                  }}
                >
                  Ver {formatLocalDate(nextDay).split(',')[0]}
                  <ChevronRightIcon aria-hidden="true" />
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <SlotGroups
            slots={slots}
            timeZone={timeZone}
            value={value}
            onValueChange={onValueChange}
            labelId={`${uid}-day`}
          />
        )}

        <p className="text-sm text-muted-foreground">
          Horários no fuso do negócio ({timeZoneName(timeZone)}).
        </p>
      </div>
    </div>
  )
}

interface SlotGroupsProps {
  slots: Slot[]
  timeZone: string
  value: string | null
  onValueChange: (startsAt: string) => void
  labelId: string
}

function SlotGroups({ slots, timeZone, value, onValueChange, labelId }: SlotGroupsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const groups = PERIODS.map((period) => ({
    ...period,
    slots: slots.filter((slot) => {
      const hour = localHour(slot.starts_at, timeZone)
      return hour >= period.from && hour < period.to
    }),
  })).filter((group) => group.slots.length > 0)

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => {
        const checkedIndex = group.slots.findIndex((slot) => slot.starts_at === value)
        const tabStop = checkedIndex >= 0 ? checkedIndex : 0
        const groupLabel = `${labelId}-${group.id}`
        return (
          <div key={group.id} className="flex flex-col gap-2.5">
            <p id={groupLabel} className="text-sm font-medium text-muted-foreground">
              {group.label}
            </p>
            <div
              role="radiogroup"
              aria-labelledby={`${labelId} ${groupLabel}`}
              className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4 sm:grid-cols-5"
            >
              {group.slots.map((slot, index) => {
                const checked = index === checkedIndex
                return (
                  <button
                    key={slot.starts_at}
                    ref={(node) => {
                      if (node === null) refs.current.delete(slot.starts_at)
                      else refs.current.set(slot.starts_at, node)
                    }}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={index === tabStop ? 0 : -1}
                    onClick={() => onValueChange(slot.starts_at)}
                    onKeyDown={(event) => {
                      const next = targetIndex(event, index, group.slots.length)
                      if (next === null) return
                      event.preventDefault()
                      const target = group.slots[next].starts_at
                      onValueChange(target)
                      refs.current.get(target)?.focus()
                    }}
                    className={cn(
                      'relative inline-flex h-11 scroll-mb-24 items-center justify-center gap-1 rounded-full border sm:scroll-mb-0 text-[0.9375rem] tabular-nums transition-[background-color,border-color,color] duration-(--duration-fast)',
                      checked
                        ? 'border-primary bg-accent font-semibold text-accent-foreground ring-1 ring-primary ring-inset'
                        : 'border-border bg-card font-medium text-foreground hover:border-input hover:bg-accent/60',
                    )}
                  >
                    {checked ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
                    {formatTime(slot.starts_at, timeZone)}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
