import { useState, type ReactNode } from 'react'
import { ArrowRightIcon, CheckIcon, ChevronLeftIcon, CircleCheckIcon } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { formatDemoDay, nextDemoDay } from '@/lib/demo-preview'

/**
 * Main section of `/` (D58). The phone frame is adapted from the Magic
 * component "Great UI Mobile Mockup" (21st.dev, id 23322, MIT): only the
 * chassis, status bar and home indicator, with the tokens of D55 instead of
 * fixed colors and without framer-motion, which is outside D50.
 *
 * The preview is an illustration: hidden from screen readers, without
 * borders, hover or pointer on the times, so nothing looks tappable.
 */

const PREVIEW_SLOTS = ['09:00', '09:30', '10:00', '13:00', '14:30', '16:00']
const CHOSEN_SLOT = '10:00'

function SignalIcons() {
  return (
    <span className="flex items-center gap-1">
      <svg className="size-3" fill="currentColor" viewBox="0 0 24 24">
        <rect x="2" y="16" width="3.5" height="5" rx="0.5" />
        <rect x="7.5" y="12" width="3.5" height="9" rx="0.5" />
        <rect x="13" y="8" width="3.5" height="13" rx="0.5" />
        <rect x="18.5" y="4" width="3.5" height="17" rx="0.5" />
      </svg>
      <svg className="h-2.5 w-4" fill="none" viewBox="0 0 24 14" stroke="currentColor" strokeWidth={2}>
        <rect x="1" y="1" width="18" height="12" rx="3" />
        <rect x="3" y="3" width="11" height="8" rx="1.5" fill="currentColor" stroke="none" />
        <path d="M21 4v6" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-68 rounded-[2.6rem] bg-foreground p-2 shadow-lg ring-1 ring-border dark:bg-muted">
      <span className="absolute top-24 -left-0.75 h-8 w-0.75 rounded-l-xs bg-inherit" />
      <span className="absolute top-36 -left-0.75 h-11 w-0.75 rounded-l-xs bg-inherit" />
      <span className="absolute top-32 -right-0.75 h-14 w-0.75 rounded-r-xs bg-inherit" />
      <div className="flex flex-col overflow-hidden rounded-[2.1rem] bg-background text-foreground">
        <div className="flex items-center justify-between px-6 pt-3 pb-1 text-xs font-semibold tabular-nums">
          <span>9:41</span>
          <SignalIcons />
        </div>
        {children}
        <div className="flex justify-center pt-1 pb-2">
          <span className="h-1 w-24 rounded-full bg-foreground/25" />
        </div>
      </div>
    </div>
  )
}

function BookingPreview() {
  // The first working day of the demo from today, in its time zone (D43, D56).
  const [day] = useState(() => formatDemoDay(nextDemoDay(new Date())))

  return (
    <div aria-hidden="true" className="pointer-events-none select-none">
      <PhoneFrame>
        <div className="flex items-center gap-3 px-4 pt-3 pb-4">
          <ChevronLeftIcon className="size-4 text-muted-foreground" />
          <span className="flex size-9 items-center justify-center rounded-full bg-primary font-heading text-sm font-semibold text-primary-foreground">
            BD
          </span>
          <div className="min-w-0">
            <p className="truncate font-heading text-[0.9375rem] leading-tight font-semibold">
              Barbearia Demo
            </p>
            <p className="text-xs text-muted-foreground">Corte · 30 min</p>
          </div>
        </div>

        <div className="border-t px-4 pt-4 pb-3">
          <p className="text-sm font-medium first-letter:uppercase">{day}</p>
          <ul className="mt-3 grid grid-cols-3 gap-x-1 gap-y-1.5 text-center text-sm tabular-nums">
            {PREVIEW_SLOTS.map((slot) =>
              slot === CHOSEN_SLOT ? (
                <li
                  key={slot}
                  className="flex items-center justify-center gap-1 rounded-full bg-accent py-1.5 font-semibold text-accent-foreground"
                >
                  <CheckIcon className="size-3.5" />
                  {slot}
                </li>
              ) : (
                <li key={slot} className="py-1.5 text-muted-foreground">
                  {slot}
                </li>
              ),
            )}
          </ul>
        </div>

        <div className="flex items-baseline justify-between border-t px-4 py-3 text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold tabular-nums">R$ 50,00</span>
        </div>

        <div className="mx-3 mb-3 flex gap-2.5 rounded-2xl bg-success-soft p-3 text-success-soft-foreground">
          <CircleCheckIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Agendamento confirmado</p>
            <p className="mt-0.5 text-xs leading-snug">
              O link para cancelar ou remarcar chega por e-mail.
            </p>
          </div>
        </div>
      </PhoneFrame>
    </div>
  )
}

export function HeroSection() {
  return (
    <section aria-labelledby="hero-title" className="border-b">
      <div className="mx-auto grid w-full max-w-5xl gap-12 px-4 pt-12 pb-14 sm:px-6 sm:pt-16 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center md:gap-10 md:py-20">
        <div>
          <h1
            id="hero-title"
            className="text-[2.375rem] leading-[1.05] font-semibold sm:text-5xl md:text-[3.25rem]"
          >
            Seus clientes marcam sozinhos. Você só atende.
          </h1>
          <p className="mt-5 max-w-[34rem] text-[1.0625rem] leading-relaxed text-pretty text-muted-foreground sm:text-lg">
            Agendamento online para barbearia, salão e estética. O cliente escolhe o serviço e um
            horário livre na sua página e, se precisar, cancela ou remarca pelo link que recebe
            por e-mail.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-11 px-5 text-base font-semibold shadow-sm">
              <Link to="/n/barbearia-demo">
                Ver a demo
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 px-5 text-base font-semibold">
              <Link to="/entrar">Entrar no painel</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-3xl bg-accent bg-[linear-gradient(var(--tile)_1px,transparent_1px),linear-gradient(90deg,var(--tile)_1px,transparent_1px)] bg-size-[1.75rem_1.75rem] px-6 py-10 [--tile:color-mix(in_oklch,var(--primary)_10%,transparent)] sm:px-10">
          <BookingPreview />
        </div>
      </div>
    </section>
  )
}
