import { CheckIcon, MailIcon } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ApiError } from '@/api/errors'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { Professional } from '@/features/scheduling'
import type { useRetryAfter } from '@/hooks/use-retry-after'
import { formatDateTime } from '@/lib/datetime'

import { useInvite, type Invitation } from '../queries'
import { inviteProblems, type InviteField } from '../situation'

interface InviteFormProps {
  timeZone: string
  /** The team as last read: an e-mail of a pending invite renews it (RN24). */
  team: Professional[]
  /** The limit of invites is per business: one wait for the form and the "Reenviar convite". */
  retry: ReturnType<typeof useRetryAfter>
}

type Sent = { invitation: Invitation; renewed: boolean }

/**
 * UC04, the invite: name and e-mail. The person gets a link to set the
 * password and only enters the bookings after accepting it (RN24). The API
 * never sends the token, only where the e-mail went and until when it is
 * valid (`202`).
 */
export function InviteForm({ timeZone, team, retry }: InviteFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState<Set<InviteField>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [emailInUse, setEmailInUse] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const [sent, setSent] = useState<Sent | null>(null)
  const invite = useInvite()
  const sending = useRef(false)
  // A second click that lands after the answer, before the redraw, still has the old name and e-mail.
  const settled = useRef(false)
  const fields = useRef<Partial<Record<InviteField, HTMLInputElement | null>>>({})
  const sentRef = useRef<HTMLDivElement>(null)
  const failureRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sent !== null) sentRef.current?.focus()
  }, [sent])
  useEffect(() => {
    if (failure !== null) failureRef.current?.focus()
  }, [failure])

  const problems = {
    ...inviteProblems(name, email),
    ...(emailInUse ? { email: 'Este e-mail já tem conta: é de alguém da equipe, de alguém desativado ou de outro negócio. Use outro e-mail.' } : {}),
  }
  const shown = (field: InviteField) =>
    showAll || touched.has(field) || (field === 'email' && emailInUse) ? problems[field] : undefined

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending.current || settled.current || retry.holding()) return
    const found = inviteProblems(name, email)
    const first = (['name', 'email'] as const).find((field) => found[field] !== undefined)
    if (first !== undefined) {
      setShowAll(true)
      fields.current[first]?.focus()
      return
    }
    const address = email.trim()
    const renewed = team.some(
      (member) => member.invitation_pending && member.is_active && member.email.toLowerCase() === address.toLowerCase(),
    )
    sending.current = true
    setFailure(null)
    setSent(null)
    try {
      const invitation = await invite.mutateAsync({ name: name.trim(), email: address })
      settled.current = true
      setName('')
      setEmail('')
      setTouched(new Set())
      setShowAll(false)
      setSent({ invitation, renewed })
    } catch (error) {
      retry.holdFor(error)
      if (error instanceof ApiError && error.code === 'EMAIL_IN_USE') {
        setEmailInUse(true)
        fields.current.email?.focus()
      } else if (error instanceof ApiError && error.status === 422 && error.fieldErrors.some((item) => item.field === 'email')) {
        setShowAll(true)
        setTouched(new Set(['email']))
        fields.current.email?.focus()
      } else {
        setFailure(error)
      }
    } finally {
      sending.current = false
    }
  }

  const busy = invite.isPending
  const errorId = (field: InviteField) => (shown(field) !== undefined ? `convite-${field}-erro` : undefined)
  const field = (key: InviteField, label: string, type: 'text' | 'email', autoComplete: string) => (
    <Field data-invalid={shown(key) !== undefined} className="gap-1.5">
      <FieldLabel htmlFor={`convite-${key}`} className="text-[0.9375rem] text-foreground">
        {label}
      </FieldLabel>
      <Input
        ref={(element) => {
          fields.current[key] = element
        }}
        id={`convite-${key}`}
        type={type}
        autoComplete={autoComplete}
        autoCapitalize={key === 'email' ? 'none' : 'words'}
        spellCheck={key === 'email' ? false : undefined}
        value={key === 'name' ? name : email}
        readOnly={busy}
        aria-invalid={shown(key) !== undefined}
        aria-describedby={errorId(key)}
        onChange={(event) => {
          settled.current = false
          if (key === 'name') setName(event.target.value)
          else {
            setEmail(event.target.value)
            setEmailInUse(false)
          }
          setFailure(null)
        }}
        onBlur={() => setTouched((current) => new Set(current).add(key))}
        className="h-11 text-base"
      />
      {shown(key) !== undefined ? <FieldError id={errorId(key)}>{shown(key)}</FieldError> : null}
    </Field>
  )

  return (
    <form noValidate aria-labelledby="convite-titulo" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="convite-titulo" className="text-xl leading-tight font-semibold sm:text-2xl">
          Convidar profissional
        </h2>
        <p className="text-[0.9375rem] text-pretty text-muted-foreground">
          A pessoa recebe um link, válido por 7 dias, para criar a senha. Ela entra nas reservas depois de aceitar.
        </p>
      </div>

      {sent !== null ? (
        <div ref={sentRef} tabIndex={-1} role="status" className="flex items-start gap-3 rounded-xl border bg-background px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
            <CheckIcon aria-hidden="true" className="size-4" strokeWidth={2.5} />
          </span>
          <p className="text-pretty">
            <span className="font-medium">
              {sent.renewed ? 'Convite renovado' : 'Convite enviado'} para {sent.invitation.email}.
            </span>{' '}
            O link vale até {formatDateTime(sent.invitation.expires_at, timeZone)}
            {sent.renewed ? '; o anterior deixou de valer.' : '.'}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {field('name', 'Nome', 'text', 'off')}
        {field('email', 'E-mail', 'email', 'off')}
      </div>

      {failure !== null ? (
        <div ref={failureRef} tabIndex={-1}>
          <ErrorMessage error={failure} title="Não foi possível enviar o convite" />
        </div>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="h-11 self-stretch px-5 text-base sm:self-start"
        disabled={busy || retry.waiting}
      >
        {busy ? (
          <>
            <Spinner aria-hidden="true" />
            Enviando…
          </>
        ) : retry.waiting ? (
          retry.label
        ) : (
          <>
            <MailIcon aria-hidden="true" className="size-5" />
            Enviar convite
          </>
        )}
      </Button>
    </form>
  )
}
