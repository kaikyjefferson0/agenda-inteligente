import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { createQueryClient } from '@/api/query-client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getAppSession } from '@/features/auth/session/session'

interface ProvidersProps {
  children: ReactNode
  /** Tests pass their own client, without retry delays. */
  queryClient?: QueryClient
}

export function Providers({ children, queryClient }: ProvidersProps) {
  const [client] = useState(() => queryClient ?? createQueryClient())
  // A login or the end of a session may change the user: no data of the
  // previous one stays in the cache.
  useEffect(() => getAppSession().onReset(() => client.clear()), [client])
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  )
}
