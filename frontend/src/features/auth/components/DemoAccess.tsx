import { ArrowRightIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useRetryAfter } from '@/hooks/use-retry-after'

import { DEMO_ACCOUNTS, demoPassword, type DemoAccount } from '../demo'
import { useLogin } from '../queries'

/**
 * One click into the demo business (D75), as the Owner or as the
 * Professional. Hidden when the build has no `VITE_DEMO_PASSWORD`.
 */
export function DemoAccess() {
  const password = demoPassword()
  const login = useLogin()
  const retry = useRetryAfter()
  const [chosen, setChosen] = useState<string | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const sending = useRef(false)

  if (password === null) return null

  const enter = async (account: DemoAccount) => {
    if (sending.current || retry.holding()) return
    sending.current = true
    setChosen(account.email)
    setFailure(null)
    try {
      await login.mutateAsync({ email: account.email, password })
    } catch (error) {
      retry.holdFor(error)
      setFailure(error)
    } finally {
      sending.current = false
    }
  }

  return (
    <section aria-labelledby="demo-titulo" className="flex flex-col gap-4 border-t pt-8">
      <div className="flex flex-col gap-1.5">
        <h2 id="demo-titulo" className="text-[1.375rem] leading-tight font-semibold">
          Conhecer pela demonstração
        </h2>
        <p className="text-muted-foreground">
          Uma barbearia fictícia, com agenda e configuração prontas. Tudo volta ao original toda
          noite.
        </p>
      </div>
      {failure !== null ? (
        <ErrorMessage error={failure} title="Não foi possível abrir a demonstração" />
      ) : null}
      <ul className="flex flex-col gap-3">
        {DEMO_ACCOUNTS.map((account) => {
          const busy = login.isPending && chosen === account.email
          return (
            <li key={account.email}>
              <Button
                type="button"
                variant="outline"
                disabled={login.isPending || retry.waiting}
                onClick={() => void enter(account)}
                className="group h-auto min-h-11 w-full justify-between gap-3 px-4 py-3 text-left whitespace-normal"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-base font-semibold text-foreground">
                    {retry.waiting && chosen === account.email ? retry.label : account.label}
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {account.description}
                  </span>
                </span>
                {busy ? (
                  <Spinner aria-label="Entrando" className="text-primary" />
                ) : (
                  <ArrowRightIcon
                    aria-hidden="true"
                    className="text-primary transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
                  />
                )}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
