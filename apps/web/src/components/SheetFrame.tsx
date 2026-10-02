import { ChevronLeft, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/** Shared chrome of every booking step: title, progress, back/close, sticky footer. */
export function SheetFrame({
  title,
  step,
  total = 4,
  onBack,
  onClose,
  children,
  footer,
}: {
  title: string
  step?: number
  total?: number
  onBack?: () => void
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 bg-surface px-4 pt-1 pb-3">
        <div className="flex items-center gap-1">
          {onBack ? (
            <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Назад">
              <ChevronLeft />
            </Button>
          ) : (
            <span className="w-9" />
          )}
          <div className="min-w-0 flex-1 text-center">
            {step !== undefined && (
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">
                Шаг {step} из {total}
              </p>
            )}
            <h2 className="truncate text-[17px] font-semibold">{title}</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Закрыть">
            <X />
          </Button>
        </div>
        {step !== undefined && (
          <div className="mt-3 flex gap-1" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i < step ? 'bg-accent' : 'bg-line'}`} />
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 px-4 pb-4">{children}</div>
      {footer && <div className="sticky bottom-0 z-10 border-t border-line bg-surface px-4 pt-3 pb-[calc(var(--dp-safe-bottom)+12px)]">{footer}</div>}
    </div>
  )
}
