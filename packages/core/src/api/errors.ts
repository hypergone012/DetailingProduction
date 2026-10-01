/** Stable error codes raised by SQL (`private.fail`) and the Edge Functions, with HTTP statuses. */
export const ERROR_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  VALIDATION: 400,
  INVALID_PHONE: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TENANT_NOT_FOUND: 404,
  BOOKING_NOT_FOUND: 404,
  PROFILE_NOT_FOUND: 404,
  SERVICE_NOT_FOUND: 404,
  VEHICLE_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  RESOURCE_NOT_FOUND: 404,
  ADDON_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  SLOT_UNAVAILABLE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CUTOFF_PASSED: 409,
  TOO_MANY_ACTIVE_BOOKINGS: 409,
  INVALID_STATUS: 409,
  INVALID_TRANSITION: 409,
  PHONE_TAKEN: 409,
  SLUG_TAKEN: 409,
  NOT_READY: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  TOO_SOON: 422,
  TOO_FAR: 422,
  IN_PAST: 422,
  TOO_EARLY: 422,
  OUTSIDE_WORKING_HOURS: 422,
  BODY_TYPE_NOT_SUPPORTED: 422,
  INVALID_ADDONS: 422,
  INVALID_RANGE: 422,
  INVALID_PRICE: 422,
  INVALID_START: 422,
  TOO_MANY_VEHICLES: 422,
  RESOURCE_NOT_SUITABLE: 422,
  HOURS_OVERLAP: 422,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  AI_BUDGET_EXHAUSTED: 429,
  INTERNAL: 500,
}

export const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION: 'Проверьте заполненные поля',
  INVALID_PHONE: 'Проверьте номер телефона',
  RATE_LIMITED: 'Слишком много запросов. Попробуйте через минуту',
  INTERNAL: 'Что-то пошло не так. Попробуйте ещё раз',
  NETWORK: 'Нет соединения с сервером',
  AI_UNAVAILABLE: 'Помощник сейчас недоступен — запись работает как обычно',
  AI_BUDGET_EXHAUSTED: 'Лимит помощника на сегодня исчерпан — запись работает как обычно',
}

export function statusForCode(code: string): number {
  return ERROR_STATUS[code] ?? 500
}

export function isKnownCode(code: string): boolean {
  return code in ERROR_STATUS
}
