/**
 * Lightweight phone input helpers for the browser. The server normalizes and validates
 * every number with libphonenumber (supabase/functions/_shared/phone.ts); here we only
 * help typing: Russian numbers are masked as +7 XXX XXX-XX-XX, others stay +<digits>.
 */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '')
}

function isRu(locale: string): boolean {
  return (locale.split('-')[1] ?? 'RU').toUpperCase() === 'RU' || locale.startsWith('ru')
}

export function formatPhoneInput(value: string, locale: string): string {
  let d = digitsOf(value)
  if (!d) return value.trim().startsWith('+') ? '+' : ''
  if (isRu(locale) && (d.startsWith('8') || d.startsWith('7') || (!value.trim().startsWith('+') && d.startsWith('9')))) {
    if (d.startsWith('8')) d = `7${d.slice(1)}`
    else if (d.startsWith('9')) d = `7${d}`
    d = d.slice(0, 11)
    const p = [d.slice(1, 4), d.slice(4, 7), d.slice(7, 9), d.slice(9, 11)]
    let out = '+7'
    if (p[0]) out += ` ${p[0]}`
    if (p[1]) out += ` ${p[1]}`
    if (p[2]) out += `-${p[2]}`
    if (p[3]) out += `-${p[3]}`
    return out
  }
  return `+${d.slice(0, 15)}`
}

export function isValidPhone(value: string, locale: string): boolean {
  const d = digitsOf(formatPhoneInput(value, locale))
  if (d.startsWith('7') && isRu(locale)) return d.length === 11 && /^7[3-9]/.test(d)
  return d.length >= 8 && d.length <= 15
}
