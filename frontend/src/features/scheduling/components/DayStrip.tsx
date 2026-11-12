import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

import { Button } from '@/components/ui/button'
import { formatLocalDate, formatLocalDayParts } from '@/lib/datetime'
import { cn } from '@/lib/utils'

import { prefersReducedMotion, targetIndex } from '../radio-keys'

/**
 * A strip of days as one keyboard-navigable radio group (D58), extracted from
 * the `DateTimePicker` so the team agenda uses it too (D66). Each day is a
 * calendar day of the business (`YYYY-MM-DD`), never of the browser (D56).
 *
 * - Scrolling (`fill` false): as many days as needed, with arrows from 640 px.
 * - Filling (`fill` true): a few days, such as a week, sharing the width.
 */

export interface DayStripHandle {
  focusDay: (day: string) => void
}

interface DayStripProps {
  days: string[]
  today: string
  value: string
  onValueChange: (day: string) => void
  label?: string
  /** Days with something on them, marked with a dot and told to screen readers. */
  marked?: ReadonlySet<string>
  markedLabel?: string
  fill?: boolean
  ref?: Ref<DayStripHandle>
}

export function DayStrip({
  days,
  today,
  value,
  onValueChange,
  label = 'Dia',
  marked,
  markedLabel = 'com agendamentos',
  fill = false,
  ref,
}: DayStripProps) {
  const strip = useRef<HTMLDivElement>(null)
  const dayRefs = useRef<(HTMLButtonElement | null)[]>([])
  const dayIndex = Math.max(0, days.indexOf(value))

  useImperativeHandle(ref, () => ({
    focusDay: (day: string) => dayRefs.current[days.indexOf(day)]?.focus(),
  }))

  // Keeps the chosen day in view, inside the strip only (never the page).
  useEffect(() => {
    const container = strip.current
    const button = dayRefs.current[dayIndex]
    if (fill || container === null || button == null) return
    const start = button.offsetLeft
    const end = start + button.offsetWidth
    if (start >= container.scrollLeft && end <= container.scrollLeft + container.clientWidth) return
    container.scrollTo?.({
      left: start - (container.clientWidth - button.offsetWidth) / 2,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [dayIndex, fill])

  const scrollStrip = (direction: 1 | -1) => {
    const container = strip.current
    container?.scrollBy?.({
      left: direction * container.clientWidth * 0.8,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }

  const arrow = 'hidden size-11 shrink-0 sm:inline-flex'

  return (
    <div className="flex min-w-0 items-center gap-1">
      {fill ? null : (
        <Button
          type="button"
          variant="ghost"
          className={arrow}
          aria-label="Dias anteriores"
          onClick={() => scrollStrip(-1)}
        >
          <ChevronLeftIcon className="size-5" aria-hidden="true" />
        </Button>
      )}
      <div
        ref={strip}
        role="radiogroup"
        aria-label={label}
        className={cn(
          'relative flex min-w-0 flex-1 gap-2 py-1',
          fill
            ? 'gap-1 sm:gap-2'
            : '-mx-4 snap-x snap-proximity overflow-x-auto scroll-px-4 px-4 [scrollbar-width:none] sm:mx-0 sm:scroll-px-0 sm:px-0 [&::-webkit-scrollbar]:hidden',
        )}
      >
        {days.map((date, index) => {
          const selected = index === dayIndex
          const parts = formatLocalDayParts(date)
          const isToday = date === today
          const isMarked = marked?.has(date) ?? false
          return (
            <button
              key={date}
              ref={(node) => {
                dayRefs.current[index] = node
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${isToday ? 'Hoje, ' : ''}${formatLocalDate(date)}${isMarked ? `, ${markedLabel}` : ''}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onValueChange(date)}
              onKeyDown={(event) => {
                const next = targetIndex(event, index, days.length)
                if (next === null) return
                event.preventDefault()
                onValueChange(days[next])
                dayRefs.current[next]?.focus()
              }}
              className={cn(
                'relative flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border text-center transition-[background-color,border-color,color] duration-(--duration-fast)',
                fill ? 'h-17 min-w-11 flex-1' : 'h-19 w-15 snap-start',
                selected
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card text-foreground hover:border-input',
              )}
            >
              <span
                className={cn(
                  'text-xs font-medium',
                  selected ? 'text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {isToday ? 'hoje' : parts.weekday}
              </span>
              <span className="text-xl leading-none font-semibold tabular-nums">{parts.day}</span>
              {fill ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    isMarked ? (selected ? 'bg-primary-foreground' : 'bg-primary') : 'bg-transparent',
                  )}
                />
              ) : (
                <span
                  className={cn(
                    'text-xs',
                    selected ? 'text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  {parts.month}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {fill ? null : (
        <Button
          type="button"
          variant="ghost"
          className={arrow}
          aria-label="Próximos dias"
          onClick={() => scrollStrip(1)}
        >
          <ChevronRightIcon className="size-5" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
