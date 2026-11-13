import { createContext, useContext, useEffect, useId } from 'react'

/**
 * The forms of the panel with changes not saved (D100). The router takes one
 * blocker at a time, and a page may have more than one form, so each form
 * only tells the provider of the panel whether it has changes, and the
 * provider asks once before leaving.
 */
export interface UnsavedChangesRegistry {
  /** Marks the form `id` as having changes, or not. */
  set: (id: string, dirty: boolean) => void
  /** Runs `action` at once without changes; with them, after the person agrees to discard. */
  confirmLeave: (action: () => void) => void
}

export const UnsavedChangesContext = createContext<UnsavedChangesRegistry | null>(null)

/**
 * Asks before leaving the page (another page of the panel, "Sair", closing or
 * reloading the tab) while `dirty` is true. A form that unmounts, as after it
 * is saved or closed, stops counting. Outside the panel it does nothing.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const registry = useContext(UnsavedChangesContext)
  const id = useId()
  useEffect(() => {
    if (registry === null) return
    registry.set(id, dirty)
    return () => registry.set(id, false)
  }, [registry, id, dirty])
}

/** For actions that leave the panel without a navigation the router sees, such as "Sair". */
export function useConfirmLeave(): (action: () => void) => void {
  const registry = useContext(UnsavedChangesContext)
  return registry?.confirmLeave ?? ((action) => action())
}
