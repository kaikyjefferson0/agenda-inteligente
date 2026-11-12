import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatLocalDate, formatTime, toLocalDate } from '@/lib/datetime'

import { EMPTY_CUSTOMER, type CustomerInput } from '../customer-schema'
import { useIdempotencyKey } from '../idempotency'
import { availabilityQuery, bookingKeys, type Booking, type PublicBusiness } from '../queries'
import { currentStep, stepsOf, useBookingFlow, type Step } from '../use-booking-flow'
import { BookingSuccess } from './BookingSuccess'
import { BookingSummary } from './BookingSummary'
import { BusinessHeader } from './BusinessHeader'
import { ContinueButton } from './ContinueButton'
import { CustomerStep } from './CustomerStep'
import { DateTimePicker } from './DateTimePicker'
import { ProfessionalStep } from './ProfessionalStep'
import { ServiceStep } from './ServiceStep'
import { StepSection } from './StepSection'

const TITLES: Record<Step, string> = {
  service: 'Escolha o serviço',
  professional: 'Escolha o profissional',
  datetime: 'Escolha o dia e o horário',
  customer: 'Seus dados',
}

/** UC10 and UC11: service → professional → day and time → customer data → success. */
export function BookingFlow({ business }: { business: PublicBusiness }) {
  const flow = useBookingFlow(business)
  const { selection, slot } = flow
  const timeZone = business.timezone
  const queryClient = useQueryClient()
  const idempotency = useIdempotencyKey()

  const [draft, setDraft] = useState<CustomerInput>(EMPTY_CUSTOMER)
  const [done, setDone] = useState<{ booking: Booking; email: string } | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  /** The slot refused with `409` in the meantime, until another is chosen. */
  const [taken, setTaken] = useState<string | null>(null)
  /** After the first choice, each new step takes the focus to its title. */
  const [navigated, setNavigated] = useState(false)

  const ready = selection.service !== null && selection.professionalId !== undefined
  const availability = useQuery({
    ...availabilityQuery(business.slug, {
      serviceId: selection.service?.id ?? '',
      date: selection.day,
      professionalId: selection.professionalId ?? null,
    }),
    enabled: ready,
  })
  const slots = availability.data?.slots
  const offered = (startsAt: string | null) =>
    startsAt !== null && slots?.some((item) => item.starts_at === startsAt) === true

  const step = currentStep(selection, offered(slot))
  const steps = stepsOf(business, selection)

  const act = <A extends unknown[]>(action: (...args: A) => void) =>
    (...args: A) => {
      setNavigated(true)
      action(...args)
    }

  const handleSlotTaken = useCallback(async () => {
    setTaken(slot)
    setPicked(null)
    // Waits for the new list, then goes back to it (UC11, 409).
    await queryClient.invalidateQueries({ queryKey: bookingKeys.availabilityOf(business.slug) })
    flow.clearSlot()
  }, [slot, queryClient, business.slug, flow])

  const professionalName =
    selection.professionalId === undefined
      ? undefined
      : selection.professionalId === null
        ? null
        : (selection.professionals.find((item) => item.id === selection.professionalId)?.name ??
          null)

  if (done !== null) {
    return (
      <Page business={business}>
        <div className="max-w-2xl">
          <BookingSuccess
            booking={done.booking}
            timeZone={timeZone}
            email={done.email}
            onStartOver={() => {
              idempotency.reset()
              setDone(null)
              setPicked(null)
              setNavigated(true)
              flow.startOver()
            }}
          />
        </div>
      </Page>
    )
  }

  const summary = (className: string) => (
    <BookingSummary
      className={className}
      timeZone={timeZone}
      service={selection.service}
      professionalName={professionalName}
      choosesProfessional={selection.choosesProfessional}
      slot={step === 'customer' ? slot : null}
      onEditService={act(flow.editService)}
      onEditProfessional={act(flow.editProfessional)}
      onEditSlot={act(() => {
        setPicked(slot)
        flow.clearSlot()
      })}
    />
  )

  return (
    <Page business={business}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
        {selection.service !== null ? summary('lg:hidden') : null}
        <StepSection
          key={step}
          title={TITLES[step]}
          position={steps.indexOf(step) + 1}
          total={steps.length}
          focusOnMount={navigated}
          className="min-w-0"
        >
          {step === 'service' ? (
            <ServiceStep
              business={business}
              selected={selection.service}
              onContinue={act(flow.chooseService)}
            />
          ) : null}
          {step === 'professional' ? (
            <ProfessionalStep
              professionals={selection.professionals}
              selected={selection.professionalId}
              onContinue={act(flow.chooseProfessional)}
            />
          ) : null}
          {step === 'datetime' ? (
            <form
              className="flex min-w-0 flex-col gap-6"
              onSubmit={(event) => {
                event.preventDefault()
                if (!offered(picked) || picked === null) return
                setNavigated(true)
                setTaken(null)
                flow.chooseSlot(picked)
              }}
            >
              <DateTimePicker
                timeZone={timeZone}
                days={selection.days}
                today={flow.today}
                day={selection.day}
                onDayChange={(day) => {
                  setTaken(null)
                  flow.chooseDay(day)
                }}
                slots={slots}
                loading={availability.isPending && ready}
                error={availability.error}
                onRetry={() => void availability.refetch()}
                value={offered(picked) ? picked : null}
                onValueChange={(startsAt) => {
                  setTaken(null)
                  setPicked(startsAt)
                }}
                maxAdvanceDays={business.max_advance_days}
                notice={
                  taken !== null ? (
                    <Alert variant="destructive">
                      <CircleAlertIcon aria-hidden="true" />
                      <AlertTitle>Esse horário acabou de ser reservado</AlertTitle>
                      <AlertDescription className="text-destructive">
                        Alguém marcou {formatLocalDate(toLocalDate(taken, timeZone)).split(',')[0]} às{' '}
                        {formatTime(taken, timeZone)} enquanto você preenchia os dados. A lista já
                        está atualizada: escolha outro horário.
                      </AlertDescription>
                    </Alert>
                  ) : null
                }
              />
              {/* On the phone the list of times is long: the action stays in reach.
                  A day without times has nothing to continue with: its empty state
                  already offers the next day. */}
              {availability.isSuccess && availability.data.slots.length === 0 ? null : (
                <div className="sticky bottom-0 z-10 -mx-4 flex border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
                  <ContinueButton disabled={!offered(picked)}>
                    {offered(picked) && picked !== null
                      ? `Continuar com ${formatTime(picked, timeZone)}`
                      : 'Continuar'}
                  </ContinueButton>
                </div>
              )}
            </form>
          ) : null}
          {step === 'customer' && selection.service !== null && slot !== null ? (
            <CustomerStep
              slug={business.slug}
              serviceId={selection.service.id}
              professionalId={selection.professionalId ?? null}
              startsAt={slot}
              draft={draft}
              onDraftChange={setDraft}
              idempotency={idempotency}
              onBooked={(booking, email) => {
                setDone({ booking, email })
                flow.clearSlot()
              }}
              onSlotTaken={() => void handleSlotTaken()}
            />
          ) : null}
        </StepSection>
        {summary('hidden lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:block')}
      </div>
    </Page>
  )
}

function Page({ business, children }: { business: PublicBusiness; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:gap-10 sm:px-6 sm:py-12">
      <title>{`${business.name} | Agenda Inteligente`}</title>
      <BusinessHeader business={business} />
      {children}
    </div>
  )
}
