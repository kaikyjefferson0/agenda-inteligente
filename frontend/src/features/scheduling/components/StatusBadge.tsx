import { CalendarCheckIcon, CalendarXIcon, CheckCheckIcon, UserXIcon, type LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { STATUS_LABELS, type AppointmentStatus } from '../status'

const STATUS: Record<AppointmentStatus, { icon: LucideIcon; className: string }> = {
  confirmed: {
    icon: CalendarCheckIcon,
    className: 'bg-success-soft text-success-soft-foreground',
  },
  completed: {
    icon: CheckCheckIcon,
    className: 'bg-success-soft text-success-soft-foreground',
  },
  cancelled: {
    icon: CalendarXIcon,
    className: 'border-border bg-muted text-foreground',
  },
  no_show: {
    icon: UserXIcon,
    className: 'border-border bg-muted text-foreground',
  },
}

/**
 * The status always in words and with an icon, never by color alone (D55).
 * Shared by the customer link and the team agenda (D66).
 */
export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { icon: Icon, className } = STATUS[status]
  const label = STATUS_LABELS[status]
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
