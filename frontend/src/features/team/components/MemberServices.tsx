import { CheckIcon, SaveIcon } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { ErrorMessage } from '@/components/feedback/ErrorMessage'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import type { Professional, Service } from '@/features/scheduling'
import { formatDuration, formatPrice } from '@/lib/format'
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes'

import { useSetServices } from '../queries'

interface MemberServicesProps {
  professional: Professional
  services: Service[]
  onClose: () => void
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((id) => b.has(id))

/**
 * UC07: which services the professional does, replacing the previous list
 * with one `PUT`. An inactive service can be kept or chosen, since RN07 is
 * applied at booking time; it is marked "Inativo", because it gives no
 * booking until it comes back.
 */
export function MemberServices({ professional, services, onClose }: MemberServicesProps) {
  const [chosen, setChosen] = useState(() => new Set(professional.service_ids))
  const [saved, setSaved] = useState(false)
  const mutation = useSetServices(professional.id)
  const sending = useRef(false)
  // A second click that lands after the answer, before the redraw, still sees the old list.
  const settled = useRef(false)
  const statusRef = useRef<HTMLDivElement>(null)
  const firstBox = useRef<HTMLButtonElement>(null)
  const dirty = !sameSet(chosen, new Set(professional.service_ids))
  useUnsavedChanges(dirty)

  useEffect(() => firstBox.current?.focus(), [])
  useEffect(() => {
    if (saved) statusRef.current?.focus()
  }, [saved])

  const ordered = [...services].sort(
    (a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, 'pt-BR'),
  )
  // A service of the list that is not in the catalog any more is dropped on saving.
  const known = new Set(services.map((service) => service.id))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending.current || settled.current || !dirty) return
    sending.current = true
    setSaved(false)
    try {
      await mutation.mutateAsync([...chosen].filter((id) => known.has(id)))
      settled.current = true
      setSaved(true)
    } catch {
      // Told below the list, from `mutation.error`.
    } finally {
      sending.current = false
    }
  }

  const busy = mutation.isPending
  const legendId = `servicos-de-${professional.id}`

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" aria-labelledby={legendId}>
      <fieldset className="flex flex-col gap-2" aria-describedby={`${legendId}-dica`}>
        <legend id={legendId} className="mb-1 text-[0.9375rem] font-semibold">
          Serviços de {professional.name}
        </legend>
        <p id={`${legendId}-dica`} className="-mt-1 mb-1 text-sm text-muted-foreground">
          Os agendamentos já marcados não mudam.
        </p>
        {ordered.map((service, index) => {
          const id = `${legendId}-${service.id}`
          return (
            <label
              key={service.id}
              htmlFor={id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2 transition-colors duration-(--duration-fast) hover:bg-accent/60 has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-accent has-[[aria-checked=true]]:text-accent-foreground"
            >
              <Checkbox
                ref={index === 0 ? firstBox : undefined}
                id={id}
                checked={chosen.has(service.id)}
                disabled={busy}
                aria-describedby={service.is_active ? undefined : `${id}-inativo`}
                onCheckedChange={(next) => {
                  settled.current = false
                  setSaved(false)
                  setChosen((current) => {
                    const copy = new Set(current)
                    if (next === true) copy.add(service.id)
                    else copy.delete(service.id)
                    return copy
                  })
                }}
              />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium">{service.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatDuration(service.duration_minutes)} · {formatPrice(service.price_cents)}
                </span>
              </span>
              {service.is_active ? null : (
                <Badge id={`${id}-inativo`} variant="secondary" className="h-6 shrink-0 px-2 text-xs">
                  Inativo
                </Badge>
              )}
            </label>
          )
        })}
      </fieldset>

      {saved ? (
        <div ref={statusRef} tabIndex={-1} role="status" className="flex items-center gap-2 text-[0.9375rem] font-medium">
          <CheckIcon aria-hidden="true" className="size-4 text-success" strokeWidth={2.5} />
          Serviços de {professional.name.split(' ')[0]} salvos.
        </div>
      ) : null}
      {mutation.isError ? <ErrorMessage error={mutation.error} title="Não foi possível salvar os serviços" /> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="lg" className="h-11 px-5 text-base" disabled={busy} onClick={onClose}>
          {saved || !dirty ? 'Fechar' : 'Cancelar'}
        </Button>
        <Button type="submit" size="lg" className="h-11 px-5 text-base" disabled={busy || !dirty}>
          {busy ? (
            <>
              <Spinner aria-hidden="true" />
              Salvando…
            </>
          ) : (
            <>
              <SaveIcon aria-hidden="true" className="size-5" />
              Salvar serviços
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
