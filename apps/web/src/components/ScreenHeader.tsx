import { ChevronLeft } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Sticky screen header. "Back" follows browser history when this screen was reached inside
 * the app, and goes to the logical parent otherwise (deep link), so Back is predictable.
 */
export function ScreenHeader({
  title,
  parent,
  actions,
  large = false,
  wide = false,
}: {
  title: string
  parent?: string
  actions?: ReactNode
  large?: boolean
  /** Full content width (owner cabinet) instead of the phone column. */
  wide?: boolean
}) {
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else if (parent) navigate(parent, { replace: true })
  }
  return (
    <header
      className={cn('sticky top-0 z-30 border-b bg-bg/95 backdrop-blur-sm transition-colors', scrolled ? 'border-line' : 'border-transparent')}
      style={{ paddingTop: 'var(--dp-safe-top)', top: 'var(--dp-header-offset, 0px)' }}
    >
      <div className={cn('mx-auto flex h-14 items-center gap-1 px-2', wide ? 'max-w-6xl' : 'max-w-xl md:max-w-2xl')}>
        {parent ? (
          <Button variant="ghost" size="icon" onClick={back} aria-label="Назад">
            <ChevronLeft />
          </Button>
        ) : (
          <span className="w-2" />
        )}
        <h1 className={cn('min-w-0 flex-1 truncate font-semibold', large ? 'text-xl' : 'text-[17px]', !parent && 'pl-2')}>{title}</h1>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
    </header>
  )
}
