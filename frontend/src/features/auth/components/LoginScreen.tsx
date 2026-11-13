import { zodResolver } from '@hookform/resolvers/zod'
import { InfoIcon } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, Navigate, useSearchParams } from 'react-router'

import { ApiError } from '@/api/errors'
import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { PageLoader } from '@/components/feedback/PageLoader'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { useRetryAfter } from '@/hooks/use-retry-after'

import { useLogin } from '../queries'
import { RETURN_PARAM, safeReturnTo } from '../return-to'
import { loginSchema, type LoginValues } from '../schemas'
import type { EndReason } from '../session/tab-sync'
import { useSession } from '../use-session'
import { AuthPage } from './AuthPage'
import { DemoAccess } from './DemoAccess'
import { PasswordInput } from './PasswordInput'
import { TextField } from './TextField'

const END_NOTICES: Record<Exclude<EndReason, 'logout'>, string> = {
  expired: 'Sua sessão terminou. Entre novamente para continuar.',
  'password-reset': 'Sua senha foi alterada. Entre com a nova senha.',
}

/** `/entrar` (UC02). With a session, goes on to the page asked for (D73). */
export function LoginScreen() {
  const session = useSession()
  const [params] = useSearchParams()
  const returnTo = safeReturnTo(params.get(RETURN_PARAM))

  if (session.status === 'authenticated') return <Navigate to={returnTo} replace />
  // The silent renewal is running: a tab that has a session leaves in a moment.
  if (session.status === 'unknown') return <PageLoader />

  const notice = session.reason !== null && session.reason !== 'logout' ? END_NOTICES[session.reason] : null

  return (
    <AuthPage
      title="Entrar"
      description="Acesse a agenda e a configuração do seu negócio com o e-mail e a senha da sua conta."
      aside={<DemoAccess />}
    >
      {notice !== null ? (
        <Alert role="status">
          <InfoIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">{notice}</AlertDescription>
        </Alert>
      ) : null}
      <LoginForm />
    </AuthPage>
  )
}

function LoginForm() {
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onTouched',
  })
  const login = useLogin()
  const retry = useRetryAfter()
  const [failure, setFailure] = useState<unknown>(null)
  // Set on the click itself: a double click never sends twice.
  const sending = useRef(false)

  const submit = form.handleSubmit(async (values) => {
    setFailure(null)
    try {
      await login.mutateAsync(values)
    } catch (error) {
      retry.holdFor(error)
      setFailure(error)
      // UC02: never says which field was wrong; the password is typed again.
      if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
        form.setValue('password', '')
        form.setFocus('password')
      }
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

  const busy = login.isPending

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6" aria-label="Entrar com e-mail e senha">
      {failure !== null ? <ErrorMessage error={failure} title="Não foi possível entrar" /> : null}
      <FieldGroup className="gap-5">
        <Controller
          name="email"
          control={form.control}
          render={({ field, fieldState }) => (
            <TextField
              id="entrar-email"
              label="E-mail"
              field={field}
              fieldState={fieldState}
              inputProps={{
                type: 'email',
                autoComplete: 'username',
                inputMode: 'email',
                autoCapitalize: 'none',
                spellCheck: false,
                readOnly: busy,
              }}
            />
          )}
        />
        <Controller
          name="password"
          control={form.control}
          render={({ field, fieldState }) => (
            <TextField
              id="entrar-senha"
              label="Senha"
              field={field}
              fieldState={fieldState}
              labelAction={
                <Link
                  to="/esqueci-senha"
                  className="-my-3 inline-flex min-h-11 items-center text-[0.9375rem] font-medium text-primary underline-offset-4 hover:underline"
                >
                  Esqueci minha senha
                </Link>
              }
              render={(props) => (
                <PasswordInput {...props} autoComplete="current-password" readOnly={busy} />
              )}
            />
          )}
        />
      </FieldGroup>
      <Button type="submit" size="lg" disabled={busy || retry.waiting} className="h-11 w-full text-base">
        {busy ? (
          <>
            <Spinner aria-hidden="true" />
            Entrando…
          </>
        ) : retry.waiting ? (
          retry.label
        ) : (
          'Entrar'
        )}
      </Button>
    </form>
  )
}
