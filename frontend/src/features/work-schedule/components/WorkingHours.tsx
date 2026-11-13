import { useState } from 'react'

import type { ScheduleAccount } from '../use-schedule-professional'
import { ScheduleShell } from './ScheduleShell'
import { WorkingHoursEditor } from './WorkingHoursEditor'

/** `/painel/expediente` (UC08). */
export function WorkingHours({ account }: { account: ScheduleAccount }) {
  const [dirty, setDirty] = useState(false)
  return (
    <ScheduleShell
      title="Expediente"
      description="Os intervalos de atendimento de cada dia da semana. Um almoço são dois intervalos no mesmo dia."
      account={account}
      dirty={dirty}
    >
      {(professional) => (
        <WorkingHoursEditor
          professional={professional}
          timeZone={account.timeZone}
          isOwner={account.isOwner}
          onDirtyChange={setDirty}
        />
      )}
    </ScheduleShell>
  )
}
