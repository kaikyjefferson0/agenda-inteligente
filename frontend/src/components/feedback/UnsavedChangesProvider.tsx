import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBlocker, type BlockerFunction } from 'react-router'

import { UnsavedChangesContext, type UnsavedChangesRegistry } from '@/hooks/use-unsaved-changes'

import { DiscardChangesDialog } from './DiscardChangesDialog'

interface UnsavedChangesProviderProps {
  /**
   * False once the session ended (here or in another tab): the panel must
   * leave for `/entrar` without asking, or it would stay stuck (D73).
   */
  enabled: boolean
  children: ReactNode
}

/**
 * D100: the one place that asks before losing changes not saved in the panel.
 * The forms say whether they have changes (`useUnsavedChanges`); here a single
 * `useBlocker` holds a navigation to another page, a `beforeunload` holds
 * closing or reloading the tab, and "Sair" asks first (`useConfirmLeave`).
 * A change of the search alone (the day of the agenda, `?profissional=`) is
 * not leaving: it never asks.
 */
export function UnsavedChangesProvider({ enabled, children }: UnsavedChangesProviderProps) {
  const dirty = useRef(new Set<string>())
  const enabledRef = useRef(enabled)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  // Before the effects of the page above, which navigate when the session ends.
  useLayoutEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const hasChanges = () => enabledRef.current && dirty.current.size > 0

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      enabledRef.current && dirty.current.size > 0 && currentLocation.pathname !== nextLocation.pathname,
    [],
  )
  const blocker = useBlocker(shouldBlock)

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!enabledRef.current || dirty.current.size === 0) return
      event.preventDefault()
      // Older browsers still need the legacy field to show their own question.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const registry = useMemo<UnsavedChangesRegistry>(
    () => ({
      set: (id, isDirty) => {
        if (isDirty) dirty.current.add(id)
        else dirty.current.delete(id)
      },
      confirmLeave: (action) => {
        if (hasChanges()) setPendingAction(() => action)
        else action()
      },
    }),
    [],
  )

  const open = blocker.state === 'blocked' || pendingAction !== null
  const cancel = () => {
    if (blocker.state === 'blocked') blocker.reset()
    setPendingAction(null)
  }
  const confirm = () => {
    const action = pendingAction
    setPendingAction(null)
    // The forms of the page are left behind: they stop counting before the next question.
    dirty.current.clear()
    if (blocker.state === 'blocked') blocker.proceed()
    action?.()
  }

  return (
    <UnsavedChangesContext.Provider value={registry}>
      {children}
      <DiscardChangesDialog
        open={open}
        title="Sair sem salvar?"
        description="Esta página tem alterações que não foram salvas. Se você sair agora, elas se perdem."
        confirmLabel="Descartar e sair"
        onCancel={cancel}
        onConfirm={confirm}
      />
    </UnsavedChangesContext.Provider>
  )
}
