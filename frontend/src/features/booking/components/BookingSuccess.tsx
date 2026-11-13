import { CheckIcon, MailIcon, MailWarningIcon } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatLocalDate, formatTimeRange, toLocalDate } from '@/lib/datetime'
import { CopyLinkButton } from '@/features/scheduling'
import { formatPrice } from '@/lib/format'

import type { Booking } from '../queries'

interface BookingSuccessProps {
  booking: Booking
  timeZone: string
  email: string
  onStartOver: () => void
}

/**
 * UC11, the end of the flow. The link (`access_url`) is the only way to see,
 * cancel or reschedule the appointment (RN16). Three cases (RN13, RN26):
 * - `queued`: the link is on the screen and on its way by e-mail;
 * - `skipped`: an e-mail limit was hit, so the link is only on the screen;
 * - `unchanged`: a repeated request of a booking already made, so the API has
 *   no link to give back (only its hash is stored); it went by e-mail.
 */
export function BookingSuccess({ booking, timeZone, email, onStartOver }: BookingSuccessProps) {
  const headingId = useId()
  const linkId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => heading.current?.focus(), [])

  const day = formatLocalDate(toLocalDate(booking.starts_at, timeZone))
  const hours = formatTimeRange(booking.starts_at, booking.ends_at, timeZone)
  const repeated = booking.email_status === 'unchanged' || booking.access_url === null

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-7">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
          <CheckIcon aria-hidden="true" className="size-6" strokeWidth={2.5} />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2
            id={headingId}
            ref={heading}
            tabIndex={-1}
            className="text-[1.75rem] leading-tight font-semibold sm:text-[1.875rem]"
          >
            {repeated ? 'Este agendamento já estava confirmado' : 'Agendamento confirmado'}
          </h2>
          <p className="text-muted-foreground">Esperamos você no horário abaixo.</p>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-4 rounded-xl border bg-card p-5 shadow-xs sm:grid-cols-2">
        <SummaryItem term="Serviço">
          {booking.service.name}
          <span className="text-muted-foreground"> · {formatPrice(booking.service.price_cents)}</span>
        </SummaryItem>
        <SummaryItem term="Profissional">{booking.professional.name}</SummaryItem>
        <SummaryItem term="Dia">
          <span className="inline-block first-letter:uppercase">{day}</span>
        </SummaryItem>
        <SummaryItem term="Horário">
          <span className="tabular-nums">{hours}</span>
        </SummaryItem>
      </dl>

      {repeated ? (
        <Alert role="status">
          <MailIcon aria-hidden="true" />
          <AlertTitle>O link foi enviado para o seu e-mail</AlertTitle>
          <AlertDescription>
            Por segurança, o link de um agendamento já feito não aparece de novo. Procure o e-mail da
            confirmação: é por ele que você consulta, cancela ou remarca.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold">
              <label htmlFor={linkId}>Link do seu agendamento</label>
            </h3>
            <p className="text-muted-foreground">
              É por este link que você consulta, cancela ou remarca. Guarde-o.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
            <Input
              ref={field}
              id={linkId}
              readOnly
              value={booking.access_url ?? ''}
              onFocus={(event) => event.currentTarget.select()}
              className="h-11 min-w-0 font-mono text-sm sm:flex-1"
            />
            <CopyLinkButton value={booking.access_url ?? ''} fieldRef={field} />
          </div>
          {booking.email_status === 'skipped' ? (
            <Alert variant="destructive" className="mt-1">
              <MailWarningIcon aria-hidden="true" />
              <AlertTitle>O e-mail não foi enviado</AlertTitle>
              <AlertDescription className="text-destructive">
                Atingimos o limite de envios agora, então este link só aparece nesta tela. Copie e
                guarde antes de sair: sem ele, só o negócio consegue alterar o agendamento.
              </AlertDescription>
            </Alert>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <MailIcon aria-hidden="true" className="size-4 shrink-0" />
              <span>
                Também enviamos o link para <span className="font-medium text-foreground">{email}</span>.
              </span>
            </p>
          )}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-11 self-start px-5 text-base"
        onClick={onStartOver}
      >
        Fazer outro agendamento
      </Button>
    </section>
  )
}

function SummaryItem({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}
