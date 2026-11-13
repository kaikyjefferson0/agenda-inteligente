import { WifiOffIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useOnline } from '@/hooks/use-online'

/** How long the return of the network stays for screen readers, after the strip leaves. */
const BACK_ONLINE_MS = 4000

/**
 * D99: the strip of "sem conexão", at the top of the content of each layout.
 * It never replaces the page: what was loaded stays on the screen, the reads
 * pause and come back with the network, and the strip leaves on its own.
 *
 * The live region is always in the page, so the change is announced; when
 * the network returns, only screen readers hear it, for a few seconds.
 */
export function OfflineNotice() {
  const online = useOnline()
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

  return (
    <div role="status" aria-atomic="true" className={online ? undefined : 'sticky top-0 z-30'}>
      {online ? (
        backOnline ? (
          <span className="sr-only">Conexão restabelecida.</span>
        ) : null
      ) : (
        <div className="bg-foreground text-background">
          <p className="mx-auto flex w-full max-w-5xl items-start gap-2.5 px-4 py-2.5 text-sm text-pretty sm:px-6">
            <WifiOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong className="font-semibold">Sem conexão.</strong> O que já carregou continua na tela; o resto
              volta quando a internet voltar.
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
