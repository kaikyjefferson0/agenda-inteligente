import { useId, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { formatLocalDate, formatTime, toLocalDate } from '@/lib/datetime'
import { formatDuration, formatPrice } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { PublicService } from '@/features/scheduling'

interface BookingSummaryProps {
  timeZone: string
  service: PublicService | null
  /** `null` is "any professional"; `undefined`, not chosen yet. */
  professionalName: string | null | undefined
  choosesProfessional: boolean
  /** Chosen slot, on the customer step. */
  slot: string | null
  onEditService: () => void
  onEditProfessional: () => void
  onEditSlot: () => void
  className?: string
}

/** What was chosen so far, each item with "Alterar". Sticky beside the steps on desktop. */
export function BookingSummary({
  timeZone,
  service,
  professionalName,
  choosesProfessional,
  slot,
  onEditService,
  onEditProfessional,
  onEditSlot,
  className,
}: BookingSummaryProps) {
  const headingId = useId()
  return (
    <aside
      aria-labelledby={headingId}
      className={cn('rounded-xl border bg-card p-4 shadow-xs sm:p-5', className)}
    >
      <h2 id={headingId} className="sr-only">Resumo do agendamento</h2>
      {service === null ? (
        <p className="text-sm text-muted-foreground">
          Escolha um serviço para começar. O resumo aparece aqui.
        </p>
      ) : (
        <dl className="flex flex-col divide-y">
          <SummaryRow
            term="Serviço"
            editLabel="Alterar serviço"
            onEdit={onEditService}
          >
            {service.name}
            <span className="block text-sm font-normal text-muted-foreground tabular-nums">
              {formatDuration(service.duration_minutes)} · {formatPrice(service.price_cents)}
            </span>
          </SummaryRow>
          {professionalName !== undefined ? (
            <SummaryRow
              term="Profissional"
              editLabel="Alterar profissional"
              onEdit={choosesProfessional ? onEditProfessional : undefined}
            >
              {professionalName ?? 'Qualquer profissional'}
            </SummaryRow>
          ) : null}
          {slot !== null ? (
            <SummaryRow term="Dia e horário" editLabel="Alterar horário" onEdit={onEditSlot}>
              <span className="inline-block first-letter:uppercase">
                {formatLocalDate(toLocalDate(slot, timeZone))}
              </span>
              <span className="block tabular-nums">às {formatTime(slot, timeZone)}</span>
            </SummaryRow>
          ) : null}
        </dl>
      )}
    </aside>
  )
}

interface SummaryRowProps {
  term: string
  editLabel: string
  /** Without it, there is nothing to change (e.g. the only professional). */
  onEdit?: () => void
  children: ReactNode
}

function SummaryRow({ term, editLabel, onEdit, children }: SummaryRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-sm text-muted-foreground">{term}</dt>
        <dd className="font-medium">{children}</dd>
      </div>
      {onEdit !== undefined ? (
        <Button
          type="button"
          variant="ghost"
          className="-my-1.5 -mr-2 h-11 shrink-0 px-3 text-[0.9375rem] text-primary hover:text-primary"
          aria-label={editLabel}
          onClick={onEdit}
        >
          Alterar
        </Button>
      ) : null}
    </div>
  )
}
