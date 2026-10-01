/** Human text for notification jobs, in the tenant's timezone. */

export type NotificationEvent = 'booking.created' | 'booking.confirmed' | 'booking.moved' | 'booking.cancelled' | 'booking.reminder'

export interface MessageInput {
  event: NotificationEvent
  audience: 'client' | 'owner'
  tenant: { name: string; slug: string; timezone: string; locale?: string }
  booking: {
    id: string
    code: string
    status: string
    starts_at: string
    service: { name: string }
    vehicle?: { make: string; model: string; plate?: string | null } | null
    customer?: { name: string } | null
  }
  now?: Date
}

export interface PushMessage {
  title: string
  body: string
  url: string
  tag: string
}

function when(iso: string, tz: string, locale: string, now: Date): string {
  const date = new Date(iso)
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const time = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(date)
  const today = day(now)
  const tomorrow = day(new Date(now.getTime() + 86400_000))
  if (day(date) === today) return `сегодня в ${time}`
  if (day(date) === tomorrow) return `завтра в ${time}`
  const d = new Intl.DateTimeFormat(locale, { timeZone: tz, day: 'numeric', month: 'long', weekday: 'short' }).format(date)
  return `${d}, ${time}`
}

export function renderMessage(m: MessageInput): PushMessage {
  const locale = m.tenant.locale ?? 'ru-RU'
  const at = when(m.booking.starts_at, m.tenant.timezone, locale, m.now ?? new Date())
  const service = m.booking.service.name
  const car = m.booking.vehicle ? `${m.booking.vehicle.make} ${m.booking.vehicle.model}` : ''
  const base = `/s/${m.tenant.slug}`
  const url = m.audience === 'owner' ? `${base}/owner/bookings/${m.booking.id}` : `${base}/history/${m.booking.id}`
  const tag = `${m.booking.id}:${m.audience}`
  if (m.audience === 'owner') {
    const who = [m.booking.customer?.name, car].filter(Boolean).join(' · ')
    const titles: Record<NotificationEvent, string> = {
      'booking.created': m.booking.status === 'pending' ? 'Новая заявка — нужно подтвердить' : 'Новая запись',
      'booking.confirmed': 'Запись подтверждена',
      'booking.moved': 'Запись перенесена',
      'booking.cancelled': 'Клиент отменил запись',
      'booking.reminder': 'Скоро визит',
    }
    return { title: titles[m.event], body: `${service} · ${at}${who ? ` · ${who}` : ''}`, url, tag }
  }
  switch (m.event) {
    case 'booking.created':
      return m.booking.status === 'pending'
        ? { title: 'Заявка принята', body: `${service}, ${at}. Студия подтвердит запись — мы пришлём уведомление.`, url, tag }
        : { title: 'Вы записаны', body: `${service}, ${at}. Ждём вас в ${m.tenant.name}.`, url, tag }
    case 'booking.confirmed':
      return { title: 'Студия подтвердила запись', body: `${service}, ${at}.`, url, tag }
    case 'booking.moved':
      return { title: 'Запись перенесена', body: `${service}: теперь ${at}.`, url, tag }
    case 'booking.cancelled':
      return { title: 'Запись отменена', body: `${service}, ${at}. Будем рады видеть вас снова.`, url, tag }
    case 'booking.reminder':
      return { title: 'Напоминание о визите', body: `${service} ${at}${car ? ` — ${car}` : ''}. ${m.tenant.name}.`, url, tag }
  }
}
