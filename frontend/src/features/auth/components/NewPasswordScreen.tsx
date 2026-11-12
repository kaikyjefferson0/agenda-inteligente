import { zodResolver } from '@hookform/resolvers/zod'
import { CircleCheckIcon, LinkIcon } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'

import { ApiError } from '@/api/errors'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { useRetryAfter } from '@/hooks/use-retry-after'

import { useAcceptInvitation, useResetPassword } from '../queries'
import {
  newPasswordSchema,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordLength,
  type NewPasswordValues,
} from '../schemas'
import { AuthPage } from './AuthPage'
import { PasswordInput } from './PasswordInput'
import { ResultPanel } from './ResultPanel'
import { TextField } from './TextField'

export type NewPasswordMode = 'reset' | 'invitation'

const COPY = {
  reset: {
    title: 'Definir nova senha',
    description:
      'Crie a senha que você vai usar para entrar. Ao salvar, as sessões abertas da conta são encerradas.',
    submit: 'Salvar nova senha',
    busy: 'Salvando…',
    failure: 'Não foi possível salvar a senha',
    doneTitle: 'Senha alterada',
    done: 'Entre com o seu e-mail e a nova senha. Por segurança, as sessões abertas foram encerradas.',
    deadTitle: 'Este link não vale mais',
    dead: 'O link de recuperação vale por uma hora e só uma vez, e um pedido novo cancela o anterior.',
    deadAction: { to: '/esqueci-senha', label: 'Pedir outro link' },
  },
  invitation: {
    title: 'Aceitar convite',
    description: 'Crie a senha da sua conta para entrar no painel da equipe.',
    submit: 'Ativar conta',
    busy: 'Ativando…',
    failure: 'Não foi possível ativar a conta',
    doneTitle: 'Conta ativada',
    done: 'Agora entre com o seu e-mail e a senha que você acabou de criar.',
    deadTitle: 'Este convite não vale mais',
    dead: 'O convite vale por 7 dias e só uma vez. Peça ao Dono do negócio para enviar um novo.',
    deadAction: { to: '/', label: 'Ir para o início' },
  },
} as const

const PASSWORD_HINT = `De ${PASSWORD_MIN} a ${PASSWORD_MAX} caracteres, sem outras regras. Uma frase que você lembre funciona bem.`

/** `400 INVALID_TOKEN`, or a token the API refused by its size (`422` on `token`). */
function isDeadLink(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.code === 'INVALID_TOKEN') return true
  return error.status === 422 && error.fieldErrors.some((item) => item.field === 'token')
}

/**
 * `/recuperar-senha/:token` (UC03) and `/convite/:token` (UC04): the same
 * form, with the RN30 policy. The token is sent in the body, never logged.
 */
export function NewPasswordScreen({ mode, token }: { mode: NewPasswordMode; token: string }) {
  const copy = COPY[mode]
  const [outcome, setOutcome] = useState<'form' | 'done' | 'dead'>('form')

  return (
    <AuthPage hasToken title={copy.title} description={copy.description}>
      {outcome === 'form' ? (
        <NewPasswordForm mode={mode} token={token} onDone={setOutcome} />
      ) : outcome === 'done' ? (
        <ResultPanel
          icon={CircleCheckIcon}
          title={copy.doneTitle}
          actions={
            <Button asChild size="lg" className="h-11 w-full text-base">
              <Link to="/entrar">Entrar</Link>
            </Button>
          }
        >
          <p>{copy.done}</p>
        </ResultPanel>
      ) : (
        <ResultPanel
          icon={LinkIcon}
          tone="neutral"
          title={copy.deadTitle}
          actions={
            <Button asChild size="lg" variant="outline" className="h-11 w-full text-base">
              <Link to={copy.deadAction.to}>{copy.deadAction.label}</Link>
            </Button>
          }
        >
          <p>{copy.dead}</p>
        </ResultPanel>
      )}
    </AuthPage>
  )
}

function NewPasswordForm({
  mode,
  token,
  onDone,
}: {
  mode: NewPasswordMode
  token: string
  onDone: (outcome: 'done' | 'dead') => void
}) {
  const copy = COPY[mode]
  const form = useForm<NewPasswordValues>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '' },
    mode: 'onTouched',
  })
  const reset = useResetPassword(token)
  const accept = useAcceptInvitation(token)
  const mutation = mode === 'reset' ? reset : accept
  const retry = useRetryAfter()
  const [failure, setFailure] = useState<unknown>(null)
  const sending = useRef(false)
  const typed = useWatch({ control: form.control, name: 'password' })

  const submit = form.handleSubmit(async ({ password }) => {
    setFailure(null)
    try {
      await mutation.mutateAsync(password)
      onDone('done')
    } catch (error) {
      if (isDeadLink(error)) {
        onDone('dead')
        return
      }
      retry.holdFor(error)
      if (error instanceof ApiError && error.fieldErrors.some((item) => item.field !== 'token')) {
        form.setError('password', { message: PASSWORD_HINT }, { shouldFocus: true })
        return
      }
      setFailure(error)
    }
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current || retry.holding()) return
    sending.current = true
    void submit(event).finally(() => {
      sending.current = false
    })
  }

  const busy = mutation.isPending
  const length = passwordLength(typed)

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6" aria-label={copy.title}>
      {failure !== null ? <ErrorMessage error={failure} title={copy.failure} /> : null}
      <FieldGroup>
        <Controller
          name="password"
          control={form.control}
          render={({ field, fieldState }) => (
            <TextField
              id="nova-senha"
              label="Nova senha"
              field={field}
              fieldState={fieldState}
              labelAction={
                <span
                  aria-hidden="true"
                  className="text-sm text-muted-foreground tabular-nums"
                  data-testid="contador-senha"
                >
                  {length === 0 ? null : `${length} ${length === 1 ? 'caractere' : 'caracteres'}`}
                </span>
              }
              description={PASSWORD_HINT}
              render={(props) => <PasswordInput {...props} autoComplete="new-password" readOnly={busy} />}
            />
          )}
        />
      </FieldGroup>
      <Button type="submit" size="lg" disabled={busy || retry.waiting} className="h-11 w-full text-base">
        {busy ? (
          <>
            <Spinner aria-hidden="true" />
            {copy.busy}
          </>
        ) : retry.waiting ? (
          retry.label
        ) : (
          copy.submit
        )}
      </Button>
    </form>
  )
}
