import { useQuery } from '@tanstack/react-query'
import { CalendarPlusIcon, CalendarX2Icon } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

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
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { DayStrip, STATUS_LABELS } from '@/features/scheduling'
import {
  addLocalDays,
  formatLocalDate,
  formatLocalDayParts,
  formatTimeRange,
  parseInstant,
  toLocalDate,
} from '@/lib/datetime'
import { cn } from '@/lib/utils'

import { weekDays, weekStartOf } from '../period'
import { agendaQuery, professionalsQuery, servicesQuery, type StaffAppointment } from '../queries'
import { useAgendaParams, type AgendaView } from '../use-agenda-params'
import { useIsDesktop } from '../use-desktop'
import { useNow } from '../use-now'
import {
  bookableProfessionals,
  canBook,
  dayColumns,
  filterOptions,
  initialsOf,
  nameOf,
  ownProfessional,
  type AgendaAccount,
} from '../viewer'
import {
  DateStepper,
  NewAppointmentButton,
  ProfessionalFilter,
  ThumbBar,
  ViewTabs,
} from './AgendaToolbar'
import { AppointmentSheet } from './AppointmentSheet'
import { CancelledGroup, DayList } from './DayList'
import { NewAppointmentSheet } from './NewAppointmentSheet'
import { TimeGrid, type GridColumn } from './TimeGrid'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** `09/11 a 15/11/2026` */
function weekLabel(first: string): string {
  const last = addLocalDays(first, 6)
  const short = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
  return `${short(first)} a ${short(last)}/${last.slice(0, 4)}`
}

/**
 * The team agenda (UC15 to UC18). On the phone, the day as a list with the
 * week strip on top and the thumb bar at the bottom; from 1024 px, the time
 * grid of the day (one column per professional when the Owner sees
 * everyone) and of the week (D80). Everything in the time zone of the
 * business (D56).
 */
export function TeamAgenda({ account }: { account: AgendaAccount }) {
  const { timeZone, isOwner } = account
  const now = useNow()
  const today = toLocalDate(now, timeZone)
  const desktop = useIsDesktop()
  const [params, update] = useAgendaParams(today)
  const [selected, setSelected] = useState<StaffAppointment | null>(null)
  const [creating, setCreating] = useState(false)
  const title = useRef<HTMLHeadingElement>(null)
  // Who opened the sheet, to take the focus back (D84).
  const opener = useRef<HTMLElement | null>(null)
  const openedId = useRef<string | null>(null)

  const remember = () => {
    const active = document.activeElement
    opener.current = active instanceof HTMLElement ? active : null
  }
  const open = (appointment: StaffAppointment) => {
    remember()
    openedId.current = appointment.id
    setSelected(appointment)
  }
  /** The button that opened, else the same appointment where it is now, else the title. */
  const giveFocusBack = () => {
    const id = openedId.current
    openedId.current = null
    const again = id === null ? null : document.querySelector<HTMLElement>(`[data-appointment-id="${id}"]`)
    const target = opener.current?.isConnected ? opener.current : (again ?? title.current)
    target?.focus()
  }

  const professionals = useQuery(professionalsQuery)
  const services = useQuery(servicesQuery)
  const team = professionals.data ?? []

  // The filter is the Owner's (D79); an unknown id in the URL is ignored.
  const options = filterOptions(team)
  const filterId =
    isOwner && params.professionalId !== null && options.some((item) => item.id === params.professionalId)
      ? params.professionalId
      : null
  const waitsForTeam = isOwner && params.professionalId !== null && !professionals.isSuccess

  const view: AgendaView = desktop ? params.view : 'dia'
  const day = params.day
  const weekStart = weekStartOf(day)
  const agenda = useQuery({ ...agendaQuery(weekStart, filterId, timeZone), enabled: !waitsForTeam })

  const week = agenda.data ?? []
  const byDay = (date: string) => week.filter((item) => toLocalDate(item.starts_at, timeZone) === date)
  const dayItems = byDay(day)
  const active = dayItems.filter((item) => item.status !== 'cancelled')
  const cancelled = dayItems.filter((item) => item.status === 'cancelled')
  const weekActive = week.filter((item) => item.status !== 'cancelled')

  const everyone = isOwner && filterId === null
  const professionalOf = (appointment: StaffAppointment) =>
    everyone ? nameOf(team, appointment.professional_id) : null
  const describe = (appointment: StaffAppointment) => {
    const parts = [
      formatTimeRange(appointment.starts_at, appointment.ends_at, timeZone),
      appointment.service_name,
      appointment.customer_name,
      ...(everyone ? [`com ${nameOf(team, appointment.professional_id)}`] : []),
      STATUS_LABELS[appointment.status],
    ]
    if (appointment.status === 'confirmed' && parseInstant(appointment.starts_at) <= now) {
      parts.push('resultado a registrar')
    }
    return parts.join(', ')
  }

  const bookable = services.data === undefined ? [] : bookableProfessionals(account, team, services.data)
  const own = ownProfessional(account, team)
  const canCreate = professionals.isSuccess && (isOwner || own !== null)
  const openNew = () => {
    remember()
    setCreating(true)
  }

  const shown = selected === null ? null : (week.find((item) => item.id === selected.id) ?? selected)

  const step = (direction: -1 | 1) =>
    update({ day: addLocalDays(day, direction * (view === 'semana' ? 7 : 1)) })

  const heading =
    view === 'semana' ? `Semana de ${weekLabel(weekStart)}` : formatLocalDate(day)
  const count = view === 'semana' ? weekActive.length : active.length
  const summary = agenda.isSuccess
    ? count === 0
      ? view === 'semana'
        ? 'nenhum agendamento na semana'
        : 'nenhum agendamento'
      : plural(count, 'agendamento', 'agendamentos')
    : null

  // A disabled agenda (waiting for the team, to check the filter) is pending too.
  const loading = agenda.isPending || professionals.isPending
  const failure = agenda.error ?? professionals.error
  const retry = () => {
    if (agenda.isError) void agenda.refetch()
    if (professionals.isError) void professionals.refetch()
  }

  const dayEmpty = (
    <DayEmpty
      onlyCancelled={cancelled.length > 0}
      onNew={canCreate ? openNew : null}
      isPast={day < today}
    />
  )

  const dayContent = (grid: boolean) =>
    active.length === 0 ? (
      dayEmpty
    ) : grid ? (
      <TimeGrid
        label={`Grade de ${formatLocalDate(day)}`}
        columns={dayGridColumns()}
        timeZone={timeZone}
        now={now}
        minColumnWidth={everyone ? 200 : 320}
        describe={describe}
        onOpen={open}
      />
    ) : (
      <DayList
        appointments={active}
        timeZone={timeZone}
        now={now}
        isToday={day === today}
        professionalOf={professionalOf}
        describe={describe}
        onOpen={open}
      />
    )

  function dayGridColumns(): GridColumn[] {
    if (everyone) {
      const columns = dayColumns(team, active)
      if (columns.length > 0) {
        return columns.map((professional) => {
          const items = active.filter((item) => item.professional_id === professional.id)
          return {
            key: professional.id,
            label: professional.name,
            appointments: items,
            isToday: day === today,
            header: (
              <ColumnHeader title={professional.name} detail={plural(items.length, 'agendamento', 'agendamentos')} />
            ),
          }
        })
      }
    }
    const name = filterId !== null ? nameOf(team, filterId) : (own?.name ?? 'Agenda')
    return [
      {
        key: 'dia',
        label: name,
        appointments: active,
        isToday: day === today,
        header: <ColumnHeader title={name} detail={plural(active.length, 'agendamento', 'agendamentos')} />,
      },
    ]
  }

  const weekColumns: GridColumn[] = weekDays(weekStart).map((date) => {
    const items = byDay(date)
    const taking = items.filter((item) => item.status !== 'cancelled')
    const dropped = items.length - taking.length
    const parts = formatLocalDayParts(date)
    const isToday = date === today
    return {
      key: date,
      label: formatLocalDate(date),
      appointments: taking,
      isToday,
      header: (
        <button
          type="button"
          onClick={() => update({ day: date, view: 'dia' })}
          aria-label={`Ver o dia ${formatLocalDate(date)}`}
          className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors duration-(--duration-fast) hover:bg-muted/60"
        >
          <span className={cn('text-xs font-medium uppercase', isToday ? 'text-primary' : 'text-muted-foreground')}>
            {isToday ? 'hoje' : parts.weekday}
          </span>
          <span className={cn('text-lg leading-none font-semibold tabular-nums', isToday && 'text-primary')}>
            {parts.day}
          </span>
          <span className="text-xs text-muted-foreground">
            {dropped > 0 ? plural(dropped, 'cancelado', 'cancelados') : ' '}
          </span>
        </button>
      ),
    }
  })

  const marked = new Set(weekActive.map((item) => toLocalDate(item.starts_at, timeZone)))

  let body: ReactNode
  if (failure !== null) {
    body = <ErrorMessage error={failure} title="Não foi possível carregar a agenda" onRetry={retry} />
  } else if (loading) {
    body = <AgendaSkeleton desktop={desktop} />
  } else if (desktop) {
    body = (
      <>
        <TabsContent value="dia" className="flex flex-col gap-4">
          {dayContent(true)}
          <CancelledGroup
            appointments={cancelled}
            timeZone={timeZone}
            professionalOf={professionalOf}
            describe={describe}
            onOpen={open}
          />
        </TabsContent>
        {/* The cancelled take no time (RN15): out of the grid, counted in the header of each day. */}
        <TabsContent value="semana" className="flex flex-col gap-3">
          <TimeGrid
            label={`Grade da semana de ${weekLabel(weekStart)}`}
            columns={weekColumns}
            timeZone={timeZone}
            now={now}
            minColumnWidth={everyone ? 168 : 136}
            tagOf={everyone ? (item) => initialsOf(nameOf(team, item.professional_id)) : undefined}
            describe={describe}
            onOpen={open}
          />
        </TabsContent>
      </>
    )
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {dayContent(false)}
        <CancelledGroup
          appointments={cancelled}
          timeZone={timeZone}
          professionalOf={professionalOf}
          describe={describe}
          onOpen={open}
        />
      </div>
    )
  }

  const filter =
    isOwner && professionals.isSuccess ? (
      <ProfessionalFilter
        options={options}
        value={filterId}
        onValueChange={(professionalId) => update({ professionalId })}
        compact={desktop}
      />
    ) : null

  return (
    <section
      aria-labelledby="agenda-titulo"
      className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 pt-5 lg:px-6 lg:pt-6 lg:pb-6"
    >
      <title>Agenda | Agenda Inteligente</title>
      <Tabs
        value={view}
        onValueChange={(next) => update({ view: next === 'semana' ? 'semana' : 'dia' })}
        className="flex flex-1 flex-col gap-4"
      >
        <header className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:gap-x-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1
              ref={title}
              id="agenda-titulo"
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight lg:text-3xl"
            >
              Agenda
            </h1>
            <p className="text-[0.9375rem] text-muted-foreground" aria-live="polite">
              <span className="inline-block font-medium text-foreground first-letter:uppercase">{heading}</span>
              {summary !== null ? <> · {summary}</> : null}
            </p>
          </div>
          {desktop ? (
            <div className="flex flex-wrap items-center gap-2">
              <DateStepper
                view={view}
                isToday={view === 'semana' ? weekStart === weekStartOf(today) : day === today}
                onStep={step}
                onToday={() => update({ day: today })}
              />
              <ViewTabs />
              {filter}
              {canCreate ? <NewAppointmentButton onClick={openNew} disabled={false} /> : null}
            </div>
          ) : (
            filter
          )}
        </header>

        {desktop ? null : (
          <DayStrip
            label="Dia da semana"
            days={weekDays(weekStart)}
            today={today}
            value={day}
            onValueChange={(date) => update({ day: date })}
            marked={agenda.isSuccess ? marked : undefined}
            fill
          />
        )}

        {body}

        {desktop ? null : (
          <ThumbBar
            isToday={day === today}
            onStep={step}
            onToday={() => update({ day: today })}
            onNew={canCreate ? openNew : null}
          />
        )}
      </Tabs>

      <AppointmentSheet
        appointment={shown}
        onClose={() => setSelected(null)}
        onReturnFocus={giveFocusBack}
        onChange={setSelected}
        onMoved={(date) => update({ day: date })}
        desktop={desktop}
        professionals={team}
        candidatesFor={(appointment) =>
          isOwner && services.data !== undefined
            ? team.filter(
                (professional) =>
                  canBook(professional, services.data) && professional.service_ids.includes(appointment.service_id),
              )
            : []
        }
        timeZone={timeZone}
        today={today}
        now={now}
      />

      <NewAppointmentSheet
        open={creating}
        onOpenChange={setCreating}
        onReturnFocus={giveFocusBack}
        desktop={desktop}
        bookable={bookable}
        fixedProfessional={!isOwner}
        professionals={team}
        services={services.data}
        servicesError={services.error}
        onRetryServices={() => void services.refetch()}
        timeZone={timeZone}
        today={today}
        now={now}
        initialDay={day}
        initialProfessionalId={filterId ?? ''}
        onShowDay={(date) => update({ day: date })}
      />
    </section>
  )
}

function ColumnHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2">
      <span className="truncate text-[0.9375rem] font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  )
}

function DayEmpty({
  onlyCancelled,
  onNew,
  isPast,
}: {
  onlyCancelled: boolean
  onNew: (() => void) | null
  isPast: boolean
}) {
  return (
    <Empty className="border border-dashed bg-card/50 py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarX2Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-base font-semibold">
          {onlyCancelled ? 'Só cancelamentos neste dia' : 'Nenhum agendamento neste dia'}
        </EmptyTitle>
        <EmptyDescription>
          {isPast
            ? 'Nada ocupou a agenda neste dia.'
            : 'Os agendamentos da página pública e os criados pela equipe aparecem aqui, no horário do negócio.'}
        </EmptyDescription>
      </EmptyHeader>
      {onNew !== null && !isPast ? (
        <EmptyContent>
          <Button type="button" variant="outline" className="h-11 px-4 text-[0.9375rem]" onClick={onNew}>
            <CalendarPlusIcon aria-hidden="true" className="size-5" />
            Novo agendamento
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}

function AgendaSkeleton({ desktop }: { desktop: boolean }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-2.5">
      <span className="sr-only">Carregando a agenda…</span>
      {desktop ? (
        <Skeleton className="h-[60svh] rounded-xl" />
      ) : (
        Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)
      )}
    </div>
  )
}
