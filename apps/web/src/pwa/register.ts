/**
 * Registers the service worker in production builds. When a new version is waiting,
 * dispatches `dp:update-ready`; the UI shows a toast and calls applyUpdate().
 */
let applyUpdateFn: (() => Promise<void>) | null = null

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        window.dispatchEvent(new CustomEvent('dp:update-ready'))
      },
    })
    applyUpdateFn = () => update(true)
  })
}

export function applyUpdate(): void {
  void applyUpdateFn?.()
}

/** Asks the SW to drop anything that is not public (used on logout / forget device). */
export function clearPrivateCaches(): void {
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_PRIVATE' })
}

export async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}
