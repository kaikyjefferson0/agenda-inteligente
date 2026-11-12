import { CheckIcon, MailIcon, MailWarningIcon } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CopyLinkButton } from '@/features/scheduling'
import { formatLocalDate, formatTimeRange, toLocalDate } from '@/lib/datetime'

import { emailNote } from '../messages'
import type { CreatedAppointment } from '../queries'

interface CreatedNoticeProps {
  created: CreatedAppointment
  professional: string
  timeZone: string
  onAnother: () => void
  onShow: () => void
}

/**
 * The end of UC16 (D82). The e-mail tells what the customer got (RN25,
 * RN26); with `access_url`, the link is on the screen with the copy button,
 * since with `skipped` it is the only place where it exists.
 */
export function CreatedNotice({ created, professional, timeZone, onAnother, onShow }: CreatedNoticeProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const linkId = useId()

  useEffect(() => heading.current?.focus(), [])

  const day = formatLocalDate(toLocalDate(created.starts_at, timeZone))
  const note = emailNote('created', created.email_status)
  const skipped = created.email_status === 'skipped'

  return (
    <section className="flex flex-col gap-6" aria-labelledby={`${linkId}-titulo`}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
          <CheckIcon aria-hidden="true" className="size-5" strokeWidth={2.5} />
        </span>
        <h3
          id={`${linkId}-titulo`}
          ref={heading}
          tabIndex={-1}
          className="pt-1.5 text-xl leading-tight font-semibold"
        >
          Agendamento criado
        </h3>
      </div>

      <dl className="grid gap-x-6 gap-y-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
        <Item term="Cliente">{created.customer_name}</Item>
        <Item term="Serviço">{created.service_name}</Item>
        <Item term="Profissional">{professional}</Item>
        <Item term="Quando">
          <span className="inline-block first-letter:uppercase">{day}</span>,{' '}
          <span className="tabular-nums">{formatTimeRange(created.starts_at, created.ends_at, timeZone)}</span>
        </Item>
      </dl>

      {created.access_url !== null ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={linkId} className="text-[0.9375rem] font-semibold">
            Link do cliente
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
            <Input
              ref={field}
              id={linkId}
              readOnly
              value={created.access_url}
              onFocus={(event) => event.currentTarget.select()}
              className="h-11 min-w-0 flex-1 font-mono text-sm"
            />
            <CopyLinkButton value={created.access_url} fieldRef={field} />
          </div>
        </div>
      ) : null}

      {skipped ? (
        <Alert variant="destructive">
          <MailWarningIcon aria-hidden="true" />
          <AlertTitle>O e-mail não foi enviado</AlertTitle>
          <AlertDescription className="text-destructive">{note}</AlertDescription>
        </Alert>
      ) : (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <MailIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{note}</span>
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="lg" className="h-11 px-5 text-base" onClick={onAnother}>
          Criar outro
        </Button>
        <Button type="button" size="lg" className="h-11 px-5 text-base" onClick={onShow}>
          Ver na agenda
        </Button>
      </div>
    </section>
  )
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}
