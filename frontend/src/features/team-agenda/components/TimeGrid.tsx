import { CheckCheckIcon, ClockAlertIcon, UserXIcon } from 'lucide-react'
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

import { formatMinutes, formatTime, localMinutes, parseInstant } from '@/lib/datetime'
import { cn } from '@/lib/utils'

import { hourRange, layoutColumn, type Placed } from '../grid-layout'
import type { StaffAppointment } from '../queries'

/**
 * The time grid of the desktop, for the day and the week (D80: the highlight
 * component that comes from Magic). Adapted from the day and week views of
 * "Event Manager" (21st.dev, vaib215, id 9127), which has a column of hours
 * and one column per day. Changed here: each block sits at its exact minute
 * of the wall clock of the business (D56), not in the cell of its hour, since
 * the team books any minute (RN19); overlapping blocks share the width in
 * lanes; the columns can also be professionals; the preparation shows as a
 * hatched tail (RN03); there is no drag and drop, the colors are the project
 * tokens and the status is told by icon and text, never by color alone (D55).
 * The header and the hours stay in place while the grid scrolls, and only the
 * grid scrolls sideways when the columns do not fit.
 */

const HOUR_PX = 80
const PX_PER_MINUTE = HOUR_PX / 60
/** A block is never shorter than one line of text. */
const MIN_BLOCK_PX = 22

export interface GridColumn {
  key: string
  /** Name of the column for screen readers, such as the professional or the day. */
  label: string
  header: ReactNode
  /** Blocks of the column: appointments not cancelled. */
  appointments: StaffAppointment[]
  /** The column is today, so it shows the "now" line. */
  isToday: boolean
}

interface TimeGridProps {
  label: string
  columns: GridColumn[]
  timeZone: string
  now: Date
  /** Narrowest column before the grid scrolls sideways. */
  minColumnWidth: number
  /** Extra line in a block, such as the initials of the professional in the week. */
  tagOf?: (appointment: StaffAppointment) => string | null
  /** Accessible name of a block. */
  describe: (appointment: StaffAppointment) => string
  onOpen: (appointment: StaffAppointment) => void
}

export function TimeGrid({
  label,
  columns,
  timeZone,
  now,
  minColumnWidth,
  tagOf,
  describe,
  onOpen,
}: TimeGridProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const all = columns.flatMap((column) => column.appointments)
  const range = hourRange(all, timeZone)
  const hours = Array.from({ length: range.to - range.from }, (_, index) => range.from + index)
  const height = hours.length * HOUR_PX
  const hasToday = columns.some((column) => column.isToday)
  const nowMinute = localMinutes(now, timeZone)
  const nowTop = (nowMinute - range.from * 60) * PX_PER_MINUTE
  const showNow = hasToday && nowTop >= 0 && nowTop <= height

  // Opens on "now" when today is on the screen, otherwise on the first block, an hour before it.
  const firstStart = all.length === 0 ? null : Math.min(...all.map((item) => localMinutes(item.starts_at, timeZone)))
  const anchor = showNow ? nowMinute : firstStart
  const columnKeys = columns.map((column) => column.key).join('|')
  useEffect(() => {
    const container = scroller.current
    if (container === null || anchor === null) return
    container.scrollTop = Math.max(0, (anchor - range.from * 60 - 60) * PX_PER_MINUTE)
    // Only when the columns change (another day or week), not at every tick of the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnKeys])

  const template: CSSProperties = {
    gridTemplateColumns: `4rem repeat(${columns.length}, minmax(${minColumnWidth}px, 1fr))`,
  }

  return (
    <div
      ref={scroller}
      role="region"
      aria-label={label}
      tabIndex={0}
      className="relative max-h-[calc(100svh-11rem)] min-h-96 overflow-auto overscroll-contain rounded-xl border bg-card shadow-xs"
    >
      <div className="grid min-w-full" style={template}>
        {/* Header: stays on top while the hours scroll. */}
        <div className="sticky top-0 left-0 z-30 border-b bg-card" />
        {columns.map((column) => (
          <div key={column.key} className="sticky top-0 z-20 min-w-0 border-b border-l bg-card">
            {column.header}
          </div>
        ))}

        {/* Hours: stay on the left while the columns scroll sideways. */}
        <div className="sticky left-0 z-10 bg-card" style={{ height }} aria-hidden="true">
          {hours.map((hour, index) => (
            <span
              key={hour}
              // The first hour sits below its line, so the sticky header never covers it.
              className={cn(
                'absolute right-2 text-xs text-muted-foreground tabular-nums',
                index === 0 ? 'translate-y-1' : '-translate-y-1/2',
              )}
              style={{ top: index * HOUR_PX }}
            >
              {formatMinutes(hour * 60)}
            </span>
          ))}
          {showNow ? (
            <span
              className="absolute right-1 z-10 -translate-y-1/2 rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums"
              style={{ top: nowTop }}
            >
              {formatTime(now, timeZone)}
            </span>
          ) : null}
        </div>

        {columns.map((column) => (
          <div
            key={column.key}
            className="relative border-l"
            style={{
              height,
              backgroundImage:
                'linear-gradient(to bottom, var(--border) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklch, var(--border) 55%, transparent) 1px, transparent 1px)',
              backgroundSize: `100% ${HOUR_PX}px, 100% ${HOUR_PX / 2}px`,
            }}
          >
            {column.isToday ? (
              <span className="pointer-events-none absolute inset-0 bg-accent/25" aria-hidden="true" />
            ) : null}
            <ul aria-label={column.label}>
              {layoutColumn(column.appointments, timeZone).map((placed) => (
                <GridBlock
                  key={placed.appointment.id}
                  placed={placed}
                  from={range.from}
                  timeZone={timeZone}
                  now={now}
                  tag={tagOf?.(placed.appointment) ?? null}
                  label={describe(placed.appointment)}
                  onOpen={onOpen}
                />
              ))}
            </ul>
            {showNow && column.isToday ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary"
                style={{ top: nowTop - 1 }}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

interface GridBlockProps {
  placed: Placed
  from: number
  timeZone: string
  now: Date
  tag: string | null
  label: string
  onOpen: (appointment: StaffAppointment) => void
}

const STATUS_STYLE = {
  confirmed: 'border-primary/30 bg-accent text-accent-foreground hover:border-primary',
  completed: 'border-success/35 bg-success-soft text-success-soft-foreground hover:border-success',
  no_show: 'border-dashed border-input bg-muted text-muted-foreground hover:border-foreground/50',
  cancelled: 'border-border bg-muted text-muted-foreground',
} as const

function GridBlock({ placed, from, timeZone, now, tag, label, onOpen }: GridBlockProps) {
  const { appointment, start, end, blockedEnd, lane, lanes } = placed
  const top = (start - from * 60) * PX_PER_MINUTE
  const height = Math.max(MIN_BLOCK_PX, (end - start) * PX_PER_MINUTE)
  const preparation = Math.max(0, (blockedEnd - end) * PX_PER_MINUTE - (height - (end - start) * PX_PER_MINUTE))
  const awaitsResult =
    appointment.status === 'confirmed' && parseInstant(appointment.starts_at).getTime() <= now.getTime()
  const position: CSSProperties = {
    top,
    left: `calc(${(lane / lanes) * 100}% + 2px)`,
    width: `calc(${100 / lanes}% - 4px)`,
  }
  const roomy = height >= 52
  const Icon =
    appointment.status === 'completed'
      ? CheckCheckIcon
      : appointment.status === 'no_show'
        ? UserXIcon
        : awaitsResult
          ? ClockAlertIcon
          : null

  return (
    <li>
      <button
        type="button"
        aria-label={label}
        data-appointment-id={appointment.id}
        onClick={() => onOpen(appointment)}
        className={cn(
          'absolute z-[1] flex flex-col overflow-hidden rounded-md border px-2 py-1 text-left text-xs leading-tight transition-[border-color] duration-(--duration-fast) focus-visible:z-20',
          STATUS_STYLE[appointment.status],
        )}
        style={{ ...position, height }}
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 font-semibold tabular-nums">{formatTime(appointment.starts_at, timeZone)}</span>
          <span className="truncate font-medium">{appointment.service_name}</span>
          {Icon !== null ? <Icon aria-hidden="true" className="ml-auto size-3.5 shrink-0" /> : null}
        </span>
        {roomy ? <span className="truncate">{appointment.customer_name}</span> : null}
        {roomy && tag !== null ? <span className="truncate font-semibold">{tag}</span> : null}
      </button>
      {preparation > 0 ? (
        <span
          aria-hidden="true"
          className="absolute rounded-b-md border border-t-0 border-dashed border-input"
          style={{
            ...position,
            top: top + height,
            height: preparation,
            backgroundImage:
              'repeating-linear-gradient(135deg, color-mix(in oklch, var(--muted-foreground) 22%, transparent) 0 1px, transparent 1px 6px)',
          }}
        />
      ) : null}
    </li>
  )
}
