import { CalendarCheckIcon, CalendarXIcon, CheckCheckIcon, UserXIcon, type LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { AppointmentStatus } from '../queries'

const STATUS: Record<AppointmentStatus, { label: string; icon: LucideIcon; className: string }> = {
  confirmed: {
    label: 'Confirmado',
    icon: CalendarCheckIcon,
    className: 'bg-success-soft text-success-soft-foreground',
  },
  completed: {
    label: 'Concluído',
    icon: CheckCheckIcon,
    className: 'bg-success-soft text-success-soft-foreground',
  },
  cancelled: {
    label: 'Cancelado',
    icon: CalendarXIcon,
    className: 'border-border bg-muted text-foreground',
  },
  no_show: {
    label: 'Não compareceu',
    icon: UserXIcon,
    className: 'border-border bg-muted text-foreground',
  },
}

/** The status always in words and with an icon, never by color alone (D55). */
export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { label, icon: Icon, className } = STATUS[status]
  return (
    <Badge
      variant="outline"
      className={cn('h-7 gap-1.5 px-2.5 text-sm [&>svg]:size-4!', className)}
    >
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  )
}
