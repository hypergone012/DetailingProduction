import { useToast } from '@astryxdesign/core/Toast'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { applyUpdate } from '@/pwa/register'

/**
 * A new build is waiting in the service worker: offer to reload (never forced mid-booking).
 * Mounted by ClientApp once `dp:update-ready` fired; shows at once and on later updates.
 */
export function UpdatePrompt() {
  const showToast = useToast()
  useEffect(() => {
    const on = () =>
      showToast({
        body: 'Доступна новая версия приложения',
        isAutoHide: false,
        uniqueID: 'sw-update',
        endContent: (
          <Button size="sm" variant="subtle" onClick={() => applyUpdate()}>
            Обновить
          </Button>
        ),
      })
    on()
    window.addEventListener('dp:update-ready', on)
    return () => window.removeEventListener('dp:update-ready', on)
  }, [showToast])
  return null
}
