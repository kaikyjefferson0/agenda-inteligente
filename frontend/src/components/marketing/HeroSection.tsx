import { ArrowRightIcon, CalendarCheckIcon, SparklesIcon } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'

/**
 * Main section of `/` (D58). Based on the Magic component "HeroSection –
 * Enterprise-Ready Landing Page Hero with Dual CTAs" (21st.dev, id 8156),
 * adapted to the tokens of D55: router links instead of click handlers, the
 * project's Button, Portuguese copy and a preview of the booking flow.
 */

const PREVIEW_SLOTS = ['09:00', '09:30', '10:00', '13:00', '14:30', '16:00']

function BookingPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-sm rounded-2xl border bg-card p-4 text-left text-card-foreground shadow-lg sm:p-5"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <CalendarCheckIcon className="size-5" />
        </span>
        <div>
          <p className="font-semibold">Barbearia Demo</p>
          <p className="text-sm text-muted-foreground">Corte · 30 min · R$ 50,00</p>
        </div>
      </div>
      <p className="mt-5 text-sm font-medium">terça-feira, 10/11</p>
      <ul className="mt-2 grid grid-cols-3 gap-2">
        {PREVIEW_SLOTS.map((slot, index) => (
          <li
            key={slot}
            className={
              index === 2
                ? 'rounded-lg bg-primary px-2 py-1.5 text-center text-sm font-medium text-primary-foreground'
                : 'rounded-lg border px-2 py-1.5 text-center text-sm'
            }
          >
            {slot}
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        Confirmado: o link para cancelar ou remarcar chega por e-mail.
      </div>
    </div>
  )
}

export function HeroSection() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden border-b bg-background text-foreground"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-80 bg-radial from-accent to-transparent to-70% opacity-80"
      />
      <div className="relative mx-auto grid w-full max-w-5xl items-center gap-10 px-4 py-12 sm:py-16 md:grid-cols-[1.1fr_1fr] md:py-20">
        <div className="flex flex-col items-center text-center md:items-start md:text-left">
          <div className="mb-6 inline-flex items-center rounded-full border bg-muted px-3 py-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <SparklesIcon className="mr-1.5 size-3 text-primary" aria-hidden="true" />
            Projeto de portfólio full stack
          </div>
          <h1
            id="hero-title"
            className="mb-4 text-4xl leading-tight font-extrabold tracking-tighter text-balance sm:text-5xl"
          >
            Agendamento online para negócios de{' '}
            <span className="text-primary">beleza e bem-estar</span>
          </h1>
          <p className="mb-8 max-w-xl text-lg text-pretty text-muted-foreground">
            O cliente escolhe o serviço e o horário em uma página pública, recebe um link para
            cancelar ou remarcar, e a equipe acompanha tudo em um painel, sempre no fuso do
            negócio.
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="lg" className="h-11 px-5 text-base font-semibold shadow-md">
              <Link to="/n/barbearia-demo">
                Ver a demo
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 px-5 text-base font-semibold"
            >
              <Link to="/entrar">Entrar no painel</Link>
            </Button>
          </div>
        </div>
        <BookingPreview />
      </div>
    </section>
  )
}
