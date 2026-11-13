import { CalendarClockIcon, CheckIcon, ExternalLinkIcon, GlobeIcon, LockIcon, SaveIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'

import { ApiError } from '@/api/errors'
import { PATHS } from '@/app/router'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/components/ui/native-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { AppointmentLinks, CopyLinkButton } from '@/features/scheduling'

import { UNIT_LABELS, type TimeUnit } from '../durations'
import { useUpdateBusiness } from '../queries'
import {
  changesOf,
  draftOf,
  normalizeSlug,
  problemsOf,
  SERVER_FIELDS,
  SERVER_TEXTS,
  SETTINGS_FIELDS,
  SLOT_STEPS,
  type BusinessChanges,
  type BusinessSettings,
  type BusinessUpdate,
  type SettingsDraft,
  type SettingsField,
  type SettingsProblems,
} from '../settings-draft'
import { zoneGroups, zoneLabel } from '../timezones'

interface BusinessSettingsFormProps {
  saved: BusinessSettings
  onSaved?: () => void
}

const sameDraft = (a: SettingsDraft, b: SettingsDraft) => JSON.stringify(a) === JSON.stringify(b)
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * UC05 (D92): every setting in one form, saved by a `PATCH` with only what
 * changed. The limits of the API, and the minimum advance not above the
 * maximum (RN05), are told on the field before sending. A new time zone is
 * explained before saving, and the answer lists the appointments that fell
 * outside the hours in it (RN22), as in the working hours (D85).
 */
export function BusinessSettingsForm({ saved, onSaved }: BusinessSettingsFormProps) {
  const [draft, setDraft] = useState<SettingsDraft>(() => draftOf(saved))
  const [touched, setTouched] = useState<Set<SettingsField>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [serverProblems, setServerProblems] = useState<SettingsProblems>({})
  const [result, setResult] = useState<BusinessUpdate | null>(null)
  const [confirming, setConfirming] = useState<BusinessChanges | null>(null)
  const mutation = useUpdateBusiness(onSaved)
  const sending = useRef(false)
  // A second click that lands after the answer, before the redraw, still has the old draft: it waits for an edit.
  const settled = useRef(false)
  const notice = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  // The offsets are those of the moment the page opened, as the list is read once.
  const [now] = useState(() => new Date())
  const groups = useMemo(() => zoneGroups(saved.timezone, now), [saved.timezone, now])
  const locked = saved.is_demo
  // Focus by id: the step is a group of radios, whose checked item takes it.
  const focusField = (field: SettingsField) =>
    document.getElementById(field === 'step' ? `negocio-step-${draft.step}` : `negocio-${field}`)?.focus()

  const dirty = !sameDraft(draft, draftOf(saved))
  useEffect(() => {
    if (result !== null) notice.current?.focus()
  }, [result])

  const problems = { ...problemsOf(draft), ...serverProblems }
  const shown = (field: SettingsField) =>
    showAll || touched.has(field) || serverProblems[field] !== undefined ? problems[field] : undefined

  const edit = (change: Partial<SettingsDraft>, fieldsChanged: SettingsField[]) => {
    settled.current = false
    setDraft((current) => ({ ...current, ...change }))
    setServerProblems((current) => {
      const next = { ...current }
      for (const field of fieldsChanged) delete next[field]
      // The two advances are checked together (RN05): editing one clears the API's refusal of the other.
      if (fieldsChanged.includes('maxAdvance')) delete next.minAdvance
      return next
    })
    mutation.reset()
    setResult((current) => (current !== null && current.appointments_outside_hours.length > 0 ? current : null))
  }
  const blur = (field: SettingsField) => setTouched((current) => new Set(current).add(field))

  const send = async (changes: BusinessChanges) => {
    if (sending.current) return
    sending.current = true
    try {
      const answer = await mutation.mutateAsync(changes)
      settled.current = true
      setDraft(draftOf(answer))
      setTouched(new Set())
      setShowAll(false)
      setResult(answer)
    } catch (error) {
      const fromServer: SettingsProblems = {}
      if (error instanceof ApiError && error.code === 'SLUG_IN_USE') {
        fromServer.slug = 'Este endereço já é de outro negócio. Escolha outro.'
      } else if (error instanceof ApiError && error.status === 422) {
        for (const item of error.fieldErrors) {
          const field = SERVER_FIELDS[item.field]
          if (field !== undefined) fromServer[field] = SERVER_TEXTS[field]
        }
      }
      const first = SETTINGS_FIELDS.find((field) => fromServer[field] !== undefined)
      if (first !== undefined) {
        setServerProblems(fromServer)
        mutation.reset()
        focusField(first)
      }
    } finally {
      sending.current = false
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (sending.current || settled.current) return
    const found = problemsOf(draft)
    const first = SETTINGS_FIELDS.find((field) => found[field] !== undefined)
    if (first !== undefined) {
      setShowAll(true)
      focusField(first)
      return
    }
    const changes = changesOf(saved, draft)
    if (Object.keys(changes).length === 0) return
    if (changes.timezone !== undefined) setConfirming(changes)
    else void send(changes)
  }

  const busy = mutation.isPending
  const errorId = (field: SettingsField) => (shown(field) !== undefined ? `negocio-${field}-erro` : undefined)
  const describedBy = (field: SettingsField, ...hints: (string | undefined)[]) =>
    [...hints, errorId(field)].filter(Boolean).join(' ') || undefined
  const error = (field: SettingsField) =>
    shown(field) !== undefined ? <FieldError id={errorId(field)}>{shown(field)}</FieldError> : null
  const label = (field: SettingsField, text: string, htmlFor = `negocio-${field}`) => (
    <FieldLabel htmlFor={htmlFor} className="text-[0.9375rem] text-foreground">
      {text}
    </FieldLabel>
  )
  const publicUrl = `${window.location.origin}${PATHS.business(saved.slug)}`
  const outside = result?.appointments_outside_hours ?? []

  const amountField = (
    field: 'minAdvance' | 'deadline',
    text: string,
    unitKey: 'minAdvanceUnit' | 'deadlineUnit',
    hint: ReactNode,
  ) => {
    const amount = draft[field]
    const one = amount.trim() === '1'
    return (
      <Field data-invalid={shown(field) !== undefined} className="gap-1.5">
        {label(field, text)}
        <div className="flex gap-2">
          <Input
            id={`negocio-${field}`}
            inputMode="numeric"
            autoComplete="off"
            value={amount}
            readOnly={busy}
            aria-invalid={shown(field) !== undefined}
            aria-describedby={describedBy(field, `negocio-${field}-dica`)}
            onChange={(event) => edit({ [field]: event.target.value }, [field])}
            onBlur={() => blur(field)}
            className="h-11 w-28 text-base tabular-nums"
          />
          <NativeSelect
            aria-label={`Unidade de ${text.toLocaleLowerCase('pt-BR')}`}
            value={draft[unitKey]}
            disabled={busy}
            onChange={(event) => edit({ [unitKey]: event.target.value as TimeUnit }, [field])}
            onBlur={() => blur(field)}
            className="min-w-32 [&_select]:h-11 [&_select]:text-base md:[&_select]:text-sm"
          >
            {(Object.keys(UNIT_LABELS) as TimeUnit[]).map((unit) => (
              <NativeSelectOption key={unit} value={unit}>
                {one ? UNIT_LABELS[unit].one : UNIT_LABELS[unit].many}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {error(field)}
        <FieldDescription id={`negocio-${field}-dica`}>{hint}</FieldDescription>
      </Field>
    )
  }

  const lockNote = (id: string) =>
    locked ? (
      <FieldDescription id={id} className="flex items-start gap-1.5">
        <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        Travado na demonstração, para que o negócio não seja usado para divulgar outro nome ou endereço.
      </FieldDescription>
    ) : null

  return (
    <div className="flex flex-col gap-6">
      {result !== null ? (
        outside.length > 0 ? (
          <div ref={notice} tabIndex={-1} className="flex flex-col gap-3">
            <Alert>
              <CalendarClockIcon aria-hidden="true" />
              <AlertTitle>
                Fuso trocado. {plural(outside.length, 'agendamento ficou', 'agendamentos ficaram')} fora do expediente
              </AlertTitle>
              <AlertDescription>
                <p>
                  {outside.length === 1 ? 'Ele continua marcado' : 'Eles continuam marcados'} no mesmo instante, que no
                  novo fuso cai fora do expediente do profissional. Remarque ou cancele pela agenda e avise o cliente.
                  Os horários abaixo já estão no novo fuso.
                </p>
              </AlertDescription>
            </Alert>
            <AppointmentLinks
              appointments={outside}
              timeZone={result.timezone}
              filterByProfessional
              showProfessional
              label="Agendamentos fora do expediente no novo fuso"
            />
          </div>
        ) : (
          <div ref={notice} tabIndex={-1} role="status" className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
              <CheckIcon aria-hidden="true" className="size-4" strokeWidth={2.5} />
            </span>
            <p className="font-medium text-pretty">Configurações salvas. Elas valem para as próximas reservas.</p>
          </div>
        )
      ) : null}

      <section aria-labelledby="negocio-endereco-publico" className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <h2 id="negocio-endereco-publico" className="flex items-center gap-2 text-base font-semibold">
          <GlobeIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          Página pública
        </h2>
        <p className="text-sm text-muted-foreground">Mande este link aos clientes para eles agendarem.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            ref={addressRef}
            readOnly
            value={publicUrl}
            aria-label="Endereço da página pública"
            onFocus={(event) => event.currentTarget.select()}
            className="h-11 min-w-0 flex-1 text-base"
          />
          <CopyLinkButton value={publicUrl} fieldRef={addressRef} />
        </div>
        <Link to={PATHS.business(saved.slug)} className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.9375rem] font-medium md:min-h-0">
          Abrir a página pública
          <ExternalLinkIcon aria-hidden="true" className="size-4" />
        </Link>
      </section>

      <form noValidate aria-label="Configurações do negócio" onSubmit={submit} className="flex flex-col gap-6">
        <section aria-labelledby="negocio-identificacao" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
          <h2 id="negocio-identificacao" className="text-lg font-semibold">
            Nome e endereço
          </h2>
          <Field data-invalid={shown('name') !== undefined} className="gap-1.5">
            {label('name', 'Nome do negócio')}
            <Input
              id="negocio-name"
              autoComplete="organization"
              value={draft.name}
              readOnly={busy || locked}
              aria-readonly={locked || undefined}
              aria-invalid={shown('name') !== undefined}
              aria-describedby={describedBy('name', locked ? 'negocio-name-trava' : undefined)}
              onChange={(event) => edit({ name: event.target.value }, ['name'])}
              onBlur={() => blur('name')}
              className="h-11 text-base read-only:aria-readonly:bg-muted read-only:aria-readonly:text-muted-foreground"
            />
            {error('name')}
            {lockNote('negocio-name-trava')}
          </Field>
          <Field data-invalid={shown('slug') !== undefined} className="gap-1.5">
            {label('slug', 'Endereço')}
            <InputGroup className="h-11 has-[[aria-readonly=true]]:bg-muted">
              <InputGroupAddon>
                <InputGroupText className="text-[0.9375rem]">/n/</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="negocio-slug"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                value={draft.slug}
                readOnly={busy || locked}
                aria-readonly={locked || undefined}
                aria-invalid={shown('slug') !== undefined}
                aria-describedby={describedBy('slug', 'negocio-slug-dica', locked ? 'negocio-slug-trava' : undefined)}
                onChange={(event) => edit({ slug: normalizeSlug(event.target.value) }, ['slug'])}
                onBlur={() => blur('slug')}
                className="text-base aria-readonly:text-muted-foreground"
              />
            </InputGroup>
            {error('slug')}
            <FieldDescription id="negocio-slug-dica">
              Letras minúsculas, números e hifens, como barbearia-central. Ao trocar, o endereço antigo deixa de
              funcionar.
            </FieldDescription>
            {lockNote('negocio-slug-trava')}
          </Field>
        </section>

        <section aria-labelledby="negocio-fuso" className="flex flex-col gap-4 rounded-xl border bg-card p-4">
          <h2 id="negocio-fuso" className="text-lg font-semibold">
            Fuso
          </h2>
          <Field data-invalid={shown('timezone') !== undefined} className="gap-1.5">
            {label('timezone', 'Fuso do negócio')}
            <NativeSelect
              id="negocio-timezone"
              value={draft.timezone}
              disabled={busy}
              aria-invalid={shown('timezone') !== undefined}
              aria-describedby={describedBy('timezone', 'negocio-timezone-dica')}
              onChange={(event) => edit({ timezone: event.target.value }, ['timezone'])}
              className="w-full [&_select]:h-11 [&_select]:text-base md:[&_select]:text-sm"
            >
              {groups.map((group) => (
                <NativeSelectOptGroup key={group.label} label={group.label}>
                  {group.zones.map((zone) => (
                    <NativeSelectOption key={zone.value} value={zone.value}>
                      {zone.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
              ))}
            </NativeSelect>
            {error('timezone')}
            <FieldDescription id="negocio-timezone-dica">
              A agenda, o expediente, a página pública e os e-mails mostram os horários neste fuso, seja qual for o do
              aparelho.
            </FieldDescription>
          </Field>
        </section>

        <section aria-labelledby="negocio-reservas" className="flex flex-col gap-5 rounded-xl border bg-card p-4">
          <h2 id="negocio-reservas" className="text-lg font-semibold">
            Reservas pela página pública
          </h2>

          <Field data-invalid={shown('step') !== undefined} className="gap-1.5">
            <FieldLabel id="negocio-step-rotulo" className="text-[0.9375rem] text-foreground">
              Intervalo entre horários
            </FieldLabel>
            <RadioGroup
              aria-labelledby="negocio-step-rotulo"
              aria-describedby="negocio-step-dica"
              value={String(draft.step)}
              disabled={busy}
              onValueChange={(value) => edit({ step: Number(value) }, ['step'])}
              className="grid grid-cols-3 gap-2 sm:grid-cols-6"
            >
              {SLOT_STEPS.map((step) => (
                <label
                  key={step}
                  htmlFor={`negocio-step-${step}`}
                  className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-background px-2 text-[0.9375rem] whitespace-nowrap tabular-nums transition-colors duration-(--duration-fast) hover:bg-accent/60 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:text-accent-foreground"
                >
                  <RadioGroupItem id={`negocio-step-${step}`} value={String(step)} />
                  {step} min
                </label>
              ))}
            </RadioGroup>
            {error('step')}
            <FieldDescription id="negocio-step-dica">
              Os horários oferecidos começam em múltiplos deste intervalo, contados da meia-noite: com 15 min, 09:00,
              09:15, 09:30… A equipe agenda em qualquer minuto.
            </FieldDescription>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            {amountField(
              'minAdvance',
              'Antecedência mínima',
              'minAdvanceUnit',
              'Quanto tempo antes do horário o cliente ainda pode agendar. 0 aceita até o último instante.',
            )}
            <Field data-invalid={shown('maxAdvance') !== undefined} className="gap-1.5">
              {label('maxAdvance', 'Antecedência máxima')}
              <InputGroup className="h-11 max-w-40">
                <InputGroupInput
                  id="negocio-maxAdvance"
                  inputMode="numeric"
                  autoComplete="off"
                  value={draft.maxAdvance}
                  readOnly={busy}
                  aria-invalid={shown('maxAdvance') !== undefined}
                  aria-describedby={describedBy('maxAdvance', 'negocio-maxAdvance-dica')}
                  onChange={(event) => edit({ maxAdvance: event.target.value }, ['maxAdvance'])}
                  onBlur={() => {
                    blur('maxAdvance')
                    blur('minAdvance')
                  }}
                  className="text-base tabular-nums"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText className="text-[0.9375rem]">
                    {draft.maxAdvance.trim() === '1' ? 'dia' : 'dias'}
                  </InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              {error('maxAdvance')}
              <FieldDescription id="negocio-maxAdvance-dica">Até quantos dias à frente a agenda abre, de 1 a 365.</FieldDescription>
            </Field>
          </div>

          {amountField(
            'deadline',
            'Prazo para o cliente alterar',
            'deadlineUnit',
            'Até quanto tempo antes do horário o cliente remarca ou cancela pelo link. Vale também para os agendamentos já feitos. 0 permite até o início.',
          )}
        </section>

        {mutation.isError ? <ErrorMessage error={mutation.error} title="Não foi possível salvar as configurações" /> : null}

        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:-mx-6 lg:px-6">
          <p className="min-w-0 text-sm text-muted-foreground" aria-live="polite">
            {dirty ? 'Alterações não salvas.' : 'Nenhuma alteração.'}
          </p>
          <Button type="submit" size="lg" className="h-11 shrink-0 px-5 text-base" disabled={busy || !dirty}>
            {busy ? (
              <>
                <Spinner aria-hidden="true" />
                Salvando…
              </>
            ) : (
              <>
                <SaveIcon aria-hidden="true" className="size-5" />
                Salvar
              </>
            )}
          </Button>
        </div>
      </form>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent className="gap-5 p-5 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader className="gap-2">
            <AlertDialogTitle className="text-xl font-semibold">Trocar o fuso do negócio?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-[0.9375rem] text-pretty">
                <p>
                  De <strong className="font-semibold text-foreground">{zoneLabel(saved.timezone, now)}</strong> para{' '}
                  <strong className="font-semibold text-foreground">{zoneLabel(draft.timezone, now)}</strong>.
                </p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-left">
                  <li>O expediente continua nas mesmas horas do relógio: 09:00 passa a ser 09:00 no novo fuso.</li>
                  <li>
                    Os agendamentos já marcados ficam no mesmo instante e passam a aparecer em outra hora. Os que caírem
                    fora do expediente são listados depois de salvar, para você remarcar ou cancelar.
                  </li>
                  <li>A agenda, a página pública e os e-mails passam a usar o novo fuso.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="-mx-5 -mb-5 p-5">
            <AlertDialogCancel size="lg" className="h-11! px-5! text-base!">
              Manter o fuso atual
            </AlertDialogCancel>
            <AlertDialogAction
              size="lg"
              className="h-11! px-5! text-base!"
              onClick={() => {
                if (confirming !== null) void send(confirming)
                setConfirming(null)
              }}
            >
              Trocar o fuso e salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
