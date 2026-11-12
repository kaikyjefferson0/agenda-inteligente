import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheckIcon } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link } from 'react-router'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { useRetryAfter } from '@/hooks/use-retry-after'

import { isDemoEmail } from '../demo'
import { useForgotPassword } from '../queries'
import { forgotPasswordSchema, type ForgotPasswordValues } from '../schemas'
import { AuthPage } from './AuthPage'
import { ResultPanel } from './ResultPanel'
import { TextField } from './TextField'

export const DEMO_RECOVERY_MESSAGE =
  'As contas da demonstração não recuperam senha. Use o acesso de demonstração na página de entrar.'

/**
 * `/esqueci-senha` (UC03). The answer is the same whether the account exists
 * or not (RN24), and the demo accounts have no recovery (RN28).
 */
export function ForgotPasswordScreen() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  // After "Usar outro e-mail", the button that was pressed is gone: the focus goes to the field.
  const [again, setAgain] = useState(false)

  return (
    <AuthPage
      title="Esqueci minha senha"
      description="Informe o e-mail da sua conta. Enviamos um link para criar uma nova senha, que vale por uma hora."
    >
      {sentTo === null ? (
        <ForgotPasswordForm onSent={setSentTo} focusOnMount={again} />
      ) : (
        <ResultPanel
          icon={MailCheckIcon}
          title="Confira seu e-mail"
          actions={
            <>
              <Button asChild size="lg" className="h-11 w-full text-base">
                <Link to="/entrar">Voltar para entrar</Link>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="h-11 w-full text-base"
                onClick={() => {
                  setAgain(true)
                  setSentTo(null)
                }}
              >
                Usar outro e-mail
              </Button>
            </>
          }
        >
          <p>
            Se <strong className="font-medium break-all text-foreground">{sentTo}</strong> for de
            uma conta ativa, o link já está a caminho. Ele vale por uma hora e só pode ser usado
            uma vez.
          </p>
          <p>Se não chegar em alguns minutos, confira a caixa de spam ou peça de novo.</p>
        </ResultPanel>
      )}
    </AuthPage>
  )
}

function ForgotPasswordForm({
  onSent,
  focusOnMount,
}: {
  onSent: (email: string) => void
  focusOnMount: boolean
}) {
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
    mode: 'onTouched',
  })
  const forgot = useForgotPassword()
  const retry = useRetryAfter()
  const [failure, setFailure] = useState<unknown>(null)
  const sending = useRef(false)

  useEffect(() => {
    if (focusOnMount) form.setFocus('email')
  }, [focusOnMount, form])

  const submit = form.handleSubmit(async ({ email }) => {
    setFailure(null)
    // RN28: the API would answer 202 and send nothing; say so instead.
    if (isDemoEmail(email)) {
      form.setError('email', { message: DEMO_RECOVERY_MESSAGE }, { shouldFocus: true })
      return
    }
    try {
      await forgot.mutateAsync(email)
      onSent(email)
    } catch (error) {
      retry.holdFor(error)
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

  const busy = forgot.isPending

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6" aria-label="Pedir link de nova senha">
      {failure !== null ? <ErrorMessage error={failure} title="Não foi possível enviar o link" /> : null}
      <FieldGroup>
        <Controller
          name="email"
          control={form.control}
          render={({ field, fieldState }) => (
            <TextField
              id="recuperar-email"
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
      </FieldGroup>
      <div className="flex flex-col gap-3">
        <Button type="submit" size="lg" disabled={busy || retry.waiting} className="h-11 w-full text-base">
          {busy ? (
            <>
              <Spinner aria-hidden="true" />
              Enviando…
            </>
          ) : retry.waiting ? (
            retry.label
          ) : (
            'Enviar link'
          )}
        </Button>
        <Button asChild variant="ghost" size="lg" className="h-11 w-full text-base">
          <Link to="/entrar">Voltar para entrar</Link>
        </Button>
      </div>
    </form>
  )
}
