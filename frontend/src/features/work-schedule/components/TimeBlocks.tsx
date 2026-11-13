import { useQuery } from '@tanstack/react-query'
import { CalendarCheckIcon, CheckIcon, InfoIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { timeBlocksQuery, type Professional, type TimeBlock } from '@/features/scheduling'
import { parseInstant, toLocalDate } from '@/lib/datetime'

import { describeBlock, upcomingBlocks } from '../block-period'
import type { ScheduleAccount } from '../use-schedule-professional'
import { RemoveBlockDialog, type RemoveResult } from './RemoveBlockDialog'
import { ScheduleShell } from './ScheduleShell'
import { TimeBlockForm } from './TimeBlockForm'

/** `/painel/bloqueios` (UC09). */
export function TimeBlocks({ account }: { account: ScheduleAccount }) {
  return (
    <ScheduleShell
      title="Bloqueios"
      description="Folgas e outras exceções ao expediente. Nenhuma reserva cai num horário bloqueado."
      account={account}
    >
      {(professional) => <BlocksOf professional={professional} account={account} />}
    </ScheduleShell>
  )
}

type Notice = { kind: 'created'; block: TimeBlock } | { kind: RemoveResult }

function BlocksOf({ professional, account }: { professional: Professional; account: ScheduleAccount }) {
  const { timeZone } = account
  const blocks = useQuery(timeBlocksQuery(professional.id))
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)
  const now = new Date()
  const today = toLocalDate(now, timeZone)

  useEffect(() => {
    if (notice !== null) noticeRef.current?.focus()
  }, [notice])

  const all = blocks.data ?? []
  const upcoming = upcomingBlocks(all, now)
  const createdId = notice?.kind === 'created' ? notice.block.id : null

  let list
  if (blocks.isPending) {
    list = (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    )
  } else if (blocks.isError) {
    list = (
      <ErrorMessage
        error={blocks.error}
        title="Não foi possível carregar os bloqueios"
        onRetry={() => void blocks.refetch()}
      />
    )
  } else if (upcoming.length === 0) {
    list = (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarCheckIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Nenhum bloqueio pela frente</EmptyTitle>
          <EmptyDescription>Todo o expediente está aberto para reservas.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    list = (
      <ul aria-labelledby="proximos-bloqueios" className="flex flex-col divide-y rounded-xl border bg-card">
        {upcoming.map((block) => {
          const when = describeBlock(block, timeZone)
          const started = parseInstant(block.starts_at).getTime() <= now.getTime()
          return (
            <li
              key={block.id}
              data-new={block.id === createdId || undefined}
              className="flex flex-col gap-3 px-4 py-3.5 transition-colors duration-(--duration-slow) data-new:bg-accent/50 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="font-semibold first-letter:uppercase">{when.days}</p>
                <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] tabular-nums">
                  {when.hours}
                  {started ? <Badge variant="secondary">Em andamento</Badge> : null}
                </p>
                <p className="text-[0.9375rem] break-words text-muted-foreground">{block.reason}</p>
              </div>
              <div className="self-end sm:self-center">
                <RemoveBlockDialog block={block} when={when} onSettled={(result) => setNotice({ kind: result })} />
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <>
      <TimeBlockForm
        professionalId={professional.id}
        timeZone={timeZone}
        today={today}
        blocks={all}
        isOwner={account.isOwner}
        onCreated={(block) => setNotice({ kind: 'created', block })}
      />

      <section aria-labelledby="proximos-bloqueios" className="flex flex-col gap-3">
        <h2 id="proximos-bloqueios" className="text-xl leading-tight font-semibold sm:text-2xl">
          Próximos bloqueios
          {blocks.isSuccess && upcoming.length > 0 ? (
            <span className="font-sans text-base font-normal text-muted-foreground tabular-nums"> ({upcoming.length})</span>
          ) : null}
        </h2>
        {notice !== null ? (
          <div
            ref={noticeRef}
            tabIndex={-1}
            role="status"
            className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
              {notice.kind === 'gone' ? (
                <InfoIcon aria-hidden="true" className="size-4" />
              ) : (
                <CheckIcon aria-hidden="true" className="size-4" strokeWidth={2.5} />
              )}
            </span>
            <p className="font-medium">{noticeText(notice, timeZone)}</p>
          </div>
        ) : null}
        {list}
      </section>
    </>
  )
}

function noticeText(notice: Notice, timeZone: string): string {
  if (notice.kind === 'removed') return 'Bloqueio removido. O horário volta a aceitar reservas.'
  if (notice.kind === 'gone') return 'Esse bloqueio já tinha sido removido. A lista foi atualizada.'
  if (notice.kind !== 'created') return ''
  const when = describeBlock(notice.block, timeZone)
  const days = when.days.charAt(0).toLocaleUpperCase('pt-BR') + when.days.slice(1)
  return `Bloqueio criado: ${days}, ${when.hours.toLocaleLowerCase('pt-BR')}.`
}
