import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'
import { HttpError } from './http.ts'

/** Normalizes a user-typed phone to E.164 using the studio's country as the default. */
export function normalizePhone(raw: string, locale: string): string {
  const country = (locale.split('-')[1] ?? 'RU').toUpperCase() as CountryCode
  const parsed = parsePhoneNumberFromString(raw, country)
  if (!parsed || !parsed.isValid()) throw new HttpError('INVALID_PHONE')
  return parsed.number
}
