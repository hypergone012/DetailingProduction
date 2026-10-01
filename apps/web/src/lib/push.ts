import { fromBase64Url } from '@dp/core/crypto'
import { serviceWorkerRegistration } from '@/pwa/register'

/**
 * Honest Web Push state. Push is never claimed to work unless a real subscription exists
 * on this device and the server accepted it.
 */
export type PushState =
  | { kind: 'unsupported'; reason: string }
  | { kind: 'needs-install'; reason: string }
  | { kind: 'disabled-by-studio' }
  | { kind: 'no-service-worker' }
  | { kind: 'denied' }
  | { kind: 'available' }
  | { kind: 'subscribed'; endpoint: string }

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export async function pushState(serverEnabled: boolean): Promise<PushState> {
  if (!serverEnabled) return { kind: 'disabled-by-studio' }
  if (isIOS() && !isStandalone()) {
    return { kind: 'needs-install', reason: 'На iPhone уведомления работают только в установленном приложении: «Поделиться» → «На экран „Домой“».' }
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { kind: 'unsupported', reason: 'Этот браузер не поддерживает push-уведомления.' }
  }
  const reg = await serviceWorkerRegistration()
  if (!reg) return { kind: 'no-service-worker' }
  if (Notification.permission === 'denied') return { kind: 'denied' }
  const sub = await reg.pushManager.getSubscription()
  return sub ? { kind: 'subscribed', endpoint: sub.endpoint } : { kind: 'available' }
}

export async function subscribePush(vapidPublicKey: string): Promise<PushSubscription> {
  const reg = await serviceWorkerRegistration()
  if (!reg) throw new Error('no service worker')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission')
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(vapidPublicKey) as BufferSource })
}

export async function unsubscribePush(): Promise<string | null> {
  const reg = await serviceWorkerRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return null
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  return endpoint
}
