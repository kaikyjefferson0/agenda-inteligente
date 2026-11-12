import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'

import { Button } from '@/components/ui/button'

interface CopyLinkButtonProps {
  value: string
  /** The field with the link: selected when the clipboard is not available. */
  fieldRef: RefObject<HTMLInputElement | null>
}

type Status = 'idle' | 'copied' | 'manual'

const MESSAGES: Record<Status, string> = {
  idle: '',
  copied: 'Link copiado.',
  manual: 'Não foi possível copiar sozinho. O link está selecionado: copie com o menu do aparelho.',
}

export function CopyLinkButton({ value, fieldRef }: CopyLinkButtonProps) {
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    if (status !== 'copied') return
    const timer = window.setTimeout(() => setStatus('idle'), 4000)
    return () => window.clearTimeout(timer)
  }, [status])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('copied')
    } catch {
      fieldRef.current?.focus()
      fieldRef.current?.select()
      setStatus('manual')
    }
  }

  return (
    <>
      <Button
        type="button"
        size="lg"
        className="h-11 shrink-0 px-5 text-base"
        onClick={() => void copy()}
      >
        {status === 'copied' ? (
          <CheckIcon aria-hidden="true" className="size-5" />
        ) : (
          <CopyIcon aria-hidden="true" className="size-5" />
        )}
        {status === 'copied' ? 'Copiado' : 'Copiar link'}
      </Button>
      <p role="status" className="text-sm text-muted-foreground empty:hidden sm:basis-full">
        {MESSAGES[status]}
      </p>
    </>
  )
}
