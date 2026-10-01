import type { BookingStatus } from '@dp/core/api/contracts'
import { Badge } from '@/components/ui/badge'
import { STATUS_LABEL } from '@/lib/format'

const TONE: Record<BookingStatus, 'accent' | 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  pending: 'warning',
  confirmed: 'success',
  in_progress: 'info',
  completed: 'neutral',
  cancelled: 'danger',
  no_show: 'danger',
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>
}
