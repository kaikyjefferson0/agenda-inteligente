import { useState } from 'react'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { PageLoader } from '@/components/feedback/PageLoader'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { toLocalDate } from '@/lib/datetime'

import type { CreatedAppointment, Professional, Service } from '../queries'
import { sheetClassName, sheetSide } from '../sheet-layout'
import { nameOf } from '../viewer'
import { AppointmentForm } from './AppointmentForm'
import { CreatedNotice } from './CreatedNotice'

interface NewAppointmentSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Radix only gives the focus back to a `SheetTrigger`; "Novo" is a plain button. */
  onReturnFocus: () => void
  desktop: boolean
  bookable: Professional[]
  fixedProfessional: boolean
  professionals: Professional[]
  /** `undefined` while the catalog loads or after an error. */
  services: Service[] | undefined
  servicesError: unknown
  onRetryServices: () => void
  timeZone: string
  today: string
  now: Date
  /** The day of the agenda and the professional of the filter, when they can be used. */
  initialDay: string
  initialProfessionalId: string
  onShowDay: (day: string) => void
}

/** UC16 in a sheet: from the right on the desktop, from the bottom on the phone (D80). */
export function NewAppointmentSheet({
  open,
  onOpenChange,
  onReturnFocus,
  desktop,
  bookable,
  fixedProfessional,
  professionals,
  services,
  servicesError,
  onRetryServices,
  timeZone,
  today,
  now,
  initialDay,
  initialProfessionalId,
  onShowDay,
}: NewAppointmentSheetProps) {
  const [created, setCreated] = useState<CreatedAppointment | null>(null)
  const [attempt, setAttempt] = useState(0)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setCreated(null)
        onOpenChange(next)
      }}
    >
      <SheetContent
        side={sheetSide(desktop)}
        className={sheetClassName(desktop)}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onReturnFocus()
        }}
      >
        <SheetHeader className="gap-1 p-0 pr-10">
          <SheetTitle className="font-heading text-2xl font-semibold tracking-tight">
            Novo agendamento
          </SheetTitle>
          <SheetDescription className="text-[0.9375rem] text-pretty">
            Sem a grade da página pública: qualquer minuto, dentro do expediente.
          </SheetDescription>
        </SheetHeader>
        {created !== null ? (
          <CreatedNotice
            created={created}
            professional={nameOf(professionals, created.professional_id)}
            timeZone={timeZone}
            onAnother={() => {
              setCreated(null)
              setAttempt((value) => value + 1)
            }}
            onShow={() => {
              onShowDay(toLocalDate(created.starts_at, timeZone))
              setCreated(null)
              onOpenChange(false)
            }}
          />
        ) : services === undefined ? (
          servicesError !== null ? (
            <ErrorMessage
              error={servicesError}
              title="Não foi possível carregar os serviços"
              onRetry={onRetryServices}
            />
          ) : (
            <PageLoader className="min-h-48" />
          )
        ) : bookable.length === 0 ? (
          <p className="text-muted-foreground">
            Nenhum profissional pode receber agendamentos agora. Para isso, ele precisa estar atendendo e
            ter ao menos um serviço ativo.
          </p>
        ) : (
          <AppointmentForm
            key={attempt}
            bookable={bookable}
            fixedProfessional={fixedProfessional}
            services={services}
            timeZone={timeZone}
            today={today}
            now={now}
            initial={{
              professionalId: fixedProfessional
                ? bookable[0].id
                : bookable.some((item) => item.id === initialProfessionalId)
                  ? initialProfessionalId
                  : bookable.length === 1
                    ? bookable[0].id
                    : '',
              day: initialDay < today ? today : initialDay,
            }}
            onCreated={setCreated}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
