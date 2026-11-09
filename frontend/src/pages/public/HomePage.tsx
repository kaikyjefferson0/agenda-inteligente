import { CalendarClockIcon, LayoutDashboardIcon, LinkIcon } from 'lucide-react'

import { HeroSection } from '@/components/marketing/HeroSection'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const FEATURES = [
  {
    icon: CalendarClockIcon,
    title: 'Página pública e reserva',
    description:
      'Horários livres calculados a partir do expediente, dos bloqueios e da antecedência, sem reservas duplicadas.',
  },
  {
    icon: LinkIcon,
    title: 'Link do cliente',
    description:
      'Sem conta e sem senha: o cliente consulta, cancela ou remarca dentro do prazo pelo link seguro.',
  },
  {
    icon: LayoutDashboardIcon,
    title: 'Painel da equipe',
    description:
      'O Dono configura negócio, serviços e equipe; cada profissional cuida da própria agenda.',
  },
]

export function HomePage() {
  return (
    <>
      <title>Agenda Inteligente</title>
      <HeroSection />
      <section aria-labelledby="features-title" className="mx-auto w-full max-w-5xl px-4 py-12">
        <h2 id="features-title" className="text-2xl font-semibold tracking-tight">
          O que o projeto mostra
        </h2>
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <li key={title}>
              <Card className="h-full">
                <CardHeader>
                  <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle>
                    <h3>{title}</h3>
                  </CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-sm text-muted-foreground">
          FastAPI, PostgreSQL, React, TypeScript, Tailwind CSS e shadcn/ui.
        </p>
      </section>
    </>
  )
}
