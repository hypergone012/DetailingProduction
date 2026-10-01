import { useToast } from '@astryxdesign/core/Toast'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { applyUpdate } from '@/pwa/register'

/** A new build is waiting in the service worker: offer to reload (never forced mid-booking). */
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
    window.addEventListener('dp:update-ready', on)
    return () => window.removeEventListener('dp:update-ready', on)
  }, [showToast])
  return null
}
