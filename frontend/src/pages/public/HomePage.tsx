import { CheckIcon, CircleCheckIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { HeroSection } from '@/components/marketing/HeroSection'

/* Each step shows a small piece of the product instead of an icon (D55). The
   pieces are illustrations, hidden from screen readers; the text says it all. */

function ServicesPiece() {
  return (
    <ul className="divide-y text-sm">
      {[
        ['Corte', '30 min', 'R$ 50,00'],
        ['Barba', '20 min', 'R$ 35,00'],
      ].map(([name, duration, price]) => (
        <li key={name} className="flex items-baseline justify-between gap-3 py-2">
          <span>
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground"> · {duration}</span>
          </span>
          <span className="tabular-nums">{price}</span>
        </li>
      ))}
    </ul>
  )
}

function TimesPiece() {
  return (
    <ul className="flex flex-wrap gap-x-1 gap-y-1.5 text-sm tabular-nums">
      {['09:00', '09:30', '10:00', '13:00'].map((slot) =>
        slot === '09:30' ? (
          <li
            key={slot}
            className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 font-semibold text-accent-foreground"
          >
            <CheckIcon className="size-3.5" />
            {slot}
          </li>
        ) : (
          <li key={slot} className="px-2.5 py-1 text-muted-foreground">
            {slot}
          </li>
        ),
      )}
    </ul>
  )
}

function AgendaPiece() {
  return (
    <ul className="divide-y text-sm">
      {[
        ['09:00', 'Corte', 'Confirmado'],
        ['10:30', 'Barba', 'Concluído'],
      ].map(([time, service, status]) => (
        <li key={time} className="flex items-center justify-between gap-3 py-2">
          <span>
            <span className="font-medium tabular-nums">{time}</span>
            <span className="text-muted-foreground"> · {service}</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success-soft-foreground">
            <CircleCheckIcon className="size-3" />
            {status}
          </span>
        </li>
      ))}
    </ul>
  )
}

interface Step {
  title: string
  description: string
  piece: ReactNode
}

const STEPS: Step[] = [
  {
    title: 'Você monta a vitrine',
    description:
      'Serviços com duração e preço, quem atende cada um e o expediente da equipe. Sua página fica em um endereço só seu.',
    piece: <ServicesPiece />,
  },
  {
    title: 'O cliente marca sozinho',
    description:
      'Ele só vê horários que cabem de verdade, já descontados intervalos, bloqueios e a antecedência mínima. Nada de reserva duplicada.',
    piece: <TimesPiece />,
  },
  {
    title: 'Sua equipe acompanha',
    description:
      'Cada profissional vê a própria agenda e marca o atendimento como concluído ou falta. O cliente cancela ou remarca pelo link, dentro do prazo.',
    piece: <AgendaPiece />,
  },
]

export function HomePage() {
  return (
    <>
      <title>Agenda Inteligente</title>
      <HeroSection />
      <section
        aria-labelledby="steps-title"
        className="mx-auto w-full max-w-5xl px-4 pt-14 pb-16 sm:px-6 md:pt-20 md:pb-24"
      >
        <h2 id="steps-title" className="text-[1.75rem] leading-tight font-semibold sm:text-3xl">
          Como funciona
        </h2>
        <ol className="mt-8 grid gap-10 md:mt-10 md:grid-cols-3 md:gap-8">
          {STEPS.map(({ title, description, piece }, index) => (
            <li key={title} className="flex flex-col">
              <div
                aria-hidden="true"
                className="pointer-events-none mb-5 flex flex-col justify-center rounded-xl border bg-card px-4 py-2 shadow-xs select-none md:min-h-24"
              >
                {piece}
              </div>
              <h3 className="flex items-baseline gap-2 text-lg font-semibold">
                <span
                  aria-hidden="true"
                  className="text-sm font-medium text-muted-foreground tabular-nums"
                >
                  {index + 1}.
                </span>
                {title}
              </h3>
              <p className="mt-2 text-pretty text-muted-foreground">{description}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
