import { LoaderCircleIcon, WifiOffIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useConnectingToServer } from '@/hooks/use-connecting-to-server'
import { useOnline } from '@/hooks/use-online'

/** How long the return of the network stays for screen readers, after the strip leaves. */
const BACK_ONLINE_MS = 4000

/**
 * The strip of the connection, at the top of the content of each layout. It
 * never replaces the page: what was loaded stays on the screen.
 *
 * - "Sem conexão" (D99): the reads pause and come back with the network, and
 *   the strip leaves on its own.
 * - "Conectando ao servidor" (D112): a read keeps retrying while the API wakes
 *   up. Quieter than the one above, since nothing is wrong on the person's
 *   side. Without a network, "sem conexão" wins.
 *
 * One live region for both, always in the page, so each change is announced;
 * when the network returns, only screen readers hear it, for a few seconds.
 */
export function ConnectionNotice() {
  const online = useOnline()
  const connecting = useConnectingToServer()
  const [backOnline, setBackOnline] = useState(false)
  const wasOnline = useRef(online)

  useEffect(() => {
    const returned = !wasOnline.current && online
    wasOnline.current = online
    if (!returned) {
      setBackOnline(false)
      return
    }
    setBackOnline(true)
    const timer = window.setTimeout(() => setBackOnline(false), BACK_ONLINE_MS)
    return () => window.clearTimeout(timer)
  }, [online])

  const visible = !online || connecting

  return (
    <div role="status" aria-atomic="true" className={visible ? 'sticky top-0 z-30' : undefined}>
      {!online ? (
        <div className="bg-foreground text-background">
          <p className="mx-auto flex w-full max-w-5xl items-start gap-2.5 px-4 py-2.5 text-sm text-pretty sm:px-6">
            <WifiOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong className="font-semibold">Sem conexão.</strong> O que já carregou continua na tela; o resto
              volta quando a internet voltar.
            </span>
          </p>
        </div>
      ) : connecting ? (
        <div className="border-b bg-muted text-foreground">
          <p className="mx-auto flex w-full max-w-5xl items-start gap-2.5 px-4 py-2.5 text-sm text-pretty sm:px-6">
            <LoaderCircleIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
            />
            <span>
              <strong className="font-semibold">Conectando ao servidor,</strong> isso pode levar até um minuto.
            </span>
          </p>
        </div>
      ) : backOnline ? (
        <span className="sr-only">Conexão restabelecida.</span>
      ) : null}
    </div>
  )
}
