/**
 * iCalendar (RFC 5545) export of one booking. Times are written in UTC, so no VTIMEZONE is
 * needed and every calendar shows the correct local time. SEQUENCE follows the booking
 * version, so re-importing after a reschedule updates the same event (same UID).
 */

export interface IcsBooking {
  id: string
  code: string
  status: string
  starts_at: string
  ends_at: string
  version: number
  service: { name: string }
  vehicle?: { make: string; model: string; plate?: string | null } | null
}

export interface IcsStudio {
  name: string
  address: string
  phone: string | null
}

function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Folds lines longer than 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (size + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += n
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export function bookingToIcs(b: IcsBooking, studio: IcsStudio, opts: { host: string; manageUrl: string; now?: Date }): string {
  const vehicle = b.vehicle ? `${b.vehicle.make} ${b.vehicle.model}${b.vehicle.plate ? ` (${b.vehicle.plate})` : ''}` : ''
  const description = [
    `Запись ${b.code}`,
    vehicle && `Автомобиль: ${vehicle}`,
    studio.phone && `Телефон студии: ${studio.phone}`,
    `Управление записью: ${opts.manageUrl}`,
  ]
    .filter(Boolean)
    .join('\n')
  const status = b.status === 'cancelled' || b.status === 'no_show' ? 'CANCELLED' : b.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//detailing-production//booking//RU',
    'CALSCALE:GREGORIAN',
    `METHOD:${status === 'CANCELLED' ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:booking-${b.id}@${opts.host}`,
    `DTSTAMP:${stamp((opts.now ?? new Date()).toISOString())}`,
    `DTSTART:${stamp(b.starts_at)}`,
    `DTEND:${stamp(b.ends_at)}`,
    `SEQUENCE:${b.version}`,
    `STATUS:${status}`,
    `SUMMARY:${escapeText(`${b.service.name} — ${studio.name}`)}`,
    studio.address ? `LOCATION:${escapeText(studio.address)}` : '',
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${opts.manageUrl}`,
    ...(status === 'CANCELLED' ? [] : ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT2H', `DESCRIPTION:${escapeText(b.service.name)}`, 'END:VALARM']),
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  return lines.map(fold).join('\r\n') + '\r\n'
}
