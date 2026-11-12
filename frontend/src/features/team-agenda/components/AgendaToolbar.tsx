import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import type { AgendaView } from '../use-agenda-params'

/** Value of "every professional" in the filter (Radix refuses an empty value). */
const ALL_PROFESSIONALS = 'todos'

interface FilterProps {
  options: { id: string; name: string }[]
  value: string | null
  onValueChange: (professionalId: string | null) => void
  className?: string
  compact?: boolean
}

/** The filter of the Owner (UC15): everyone, or one professional. */
export function ProfessionalFilter({ options, value, onValueChange, className, compact = false }: FilterProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <label htmlFor="filtro-profissional" className="shrink-0 text-[0.9375rem] font-medium">
        Profissional
      </label>
      <Select
        name="profissional"
        value={value ?? ALL_PROFESSIONALS}
        onValueChange={(next) => onValueChange(next === ALL_PROFESSIONALS ? null : next)}
      >
        <SelectTrigger
          id="filtro-profissional"
          className={cn('min-w-0 flex-1 text-[0.9375rem]', compact ? 'h-9! w-52' : 'h-11! w-full')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value={ALL_PROFESSIONALS} className="min-h-11 text-base md:min-h-9">
            Todos os profissionais
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id} className="min-h-11 text-base md:min-h-9">
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

interface StepperProps {
  view: AgendaView
  isToday: boolean
  onStep: (direction: -1 | 1) => void
  onToday: () => void
}

/** `‹ Hoje ›` of the desktop: a day in the day view, a week in the week view. */
export function DateStepper({ view, isToday, onStep, onToday }: StepperProps) {
  const unit = view === 'semana' ? 'Semana' : 'Dia'
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon-lg" aria-label={`${unit} anterior`} onClick={() => onStep(-1)}>
        <ChevronLeftIcon aria-hidden="true" className="size-4.5" />
      </Button>
      <Button type="button" variant="outline" size="lg" className="px-3.5" disabled={isToday} onClick={onToday}>
        Hoje
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        aria-label={`${view === 'semana' ? 'Próxima semana' : 'Próximo dia'}`}
        onClick={() => onStep(1)}
      >
        <ChevronRightIcon aria-hidden="true" className="size-4.5" />
      </Button>
    </div>
  )
}

/** The switch of view, inside the `Tabs` of the agenda. */
export function ViewTabs() {
  return (
    <TabsList aria-label="Visão" className="h-9! p-[3px]">
      <TabsTrigger value="dia" className="px-3.5 text-[0.9375rem]">
        Dia
      </TabsTrigger>
      <TabsTrigger value="semana" className="px-3.5 text-[0.9375rem]">
        Semana
      </TabsTrigger>
    </TabsList>
  )
}

export function NewAppointmentButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <Button type="button" size="lg" className="px-3.5 text-[0.9375rem]" disabled={disabled} onClick={onClick}>
      <PlusIcon aria-hidden="true" className="size-4.5" />
      Novo agendamento
    </Button>
  )
}

interface ThumbBarProps {
  isToday: boolean
  onStep: (direction: -1 | 1) => void
  onToday: () => void
  onNew: (() => void) | null
}

/**
 * The phone (D80): day by day and the new appointment within thumb reach,
 * at the bottom of the screen, 44 px each. It sticks to the bottom of the
 * content, so the side menu from 768 px never covers it.
 */
export function ThumbBar({ isToday, onStep, onToday, onNew }: ThumbBarProps) {
  return (
    <nav
      aria-label="Navegação da agenda"
      className="sticky bottom-0 z-20 -mx-4 mt-auto border-t bg-background px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" className="size-11 shrink-0" aria-label="Dia anterior" onClick={() => onStep(-1)}>
          <ChevronLeftIcon aria-hidden="true" className="size-5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-0 flex-1 text-[0.9375rem]"
          disabled={isToday}
          onClick={onToday}
        >
          Hoje
        </Button>
        <Button type="button" variant="outline" className="size-11 shrink-0" aria-label="Próximo dia" onClick={() => onStep(1)}>
          <ChevronRightIcon aria-hidden="true" className="size-5" />
        </Button>
        {onNew !== null ? (
          <Button type="button" className="h-11 shrink-0 px-4 text-[0.9375rem]" onClick={onNew}>
            <PlusIcon aria-hidden="true" className="size-5" />
            Novo
          </Button>
        ) : null}
      </div>
    </nav>
  )
}
