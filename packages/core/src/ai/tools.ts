import { z } from 'zod'
import { BODY_TYPES } from '../tenant/constants.ts'

/**
 * Assistant tools. The model can only *ask* for data through these; the server executes
 * them inside the scope it already resolved (studio from the URL, client from the device
 * key, owner from the signed-in JWT + membership). No tool accepts a tenant id, a price, a
 * resource id, a role or SQL — those never come from the model.
 *
 * Every input is validated with Zod before execution; the JSON schemas sent to the API are
 * written by hand in the subset strict tool use accepts.
 */
export type ToolScope = 'client' | 'owner'

const day = z.iso.date()
const uuid = z.uuid()
const bodyType = z.enum(BODY_TYPES).nullable().optional()
const dayPart = z.enum(['morning', 'day', 'evening']).nullable().optional()

export const toolInputs = {
  list_services: z.strictObject({}),
  check_availability: z.strictObject({
    service_id: uuid,
    date: day,
    days: z.number().int().min(1).max(7).optional(),
    body_type: bodyType,
    part_of_day: dayPart,
  }),
  studio_info: z.strictObject({ topic: z.enum(['hours', 'address', 'contacts', 'policy']) }),
  my_bookings: z.strictObject({}),
  propose_booking: z.strictObject({
    service_id: uuid,
    starts_at: z.iso.datetime({ offset: true }),
    body_type: bodyType,
  }),
  day_schedule: z.strictObject({ date: day }),
  find_customers: z.strictObject({ query: z.string().trim().min(2).max(60) }),
  period_stats: z.strictObject({ from: day, to: day }),
  booking_by_code: z.strictObject({ code: z.string().trim().toUpperCase().regex(/^[2-9A-Z]{6}$/) }),
} as const

export type ToolName = keyof typeof toolInputs
export type ToolInput<N extends ToolName> = z.output<(typeof toolInputs)[N]>

const BODY_ENUM = { type: 'string', enum: [...BODY_TYPES], description: 'Тип кузова, если клиент его назвал' }
const DATE = (description: string) => ({ type: 'string', description: `${description}, формат YYYY-MM-DD` })

interface ToolSpec {
  name: ToolName
  scopes: ToolScope[]
  description: string
  input_schema: Record<string, unknown>
}

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false })

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'list_services',
    scopes: ['client', 'owner'],
    description: 'Услуги студии: id, название, описание, длительность, цены (базовая и по типам кузова), доп. услуги. Вызывай перед любым ответом про услуги и цены.',
    input_schema: obj({}, []),
  },
  {
    name: 'check_availability',
    scopes: ['client', 'owner'],
    description: 'Свободное время для записи на услугу с даты (в часовом поясе студии) и точная цена для типа кузова. Возвращает до 40 ближайших начал записи.',
    input_schema: obj(
      {
        service_id: { type: 'string', description: 'id услуги из list_services' },
        date: DATE('Первый день поиска'),
        days: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7], description: 'Сколько дней искать, по умолчанию 3' },
        body_type: BODY_ENUM,
        part_of_day: { type: 'string', enum: ['morning', 'day', 'evening'], description: 'Утро (до 12), день (12–17) или вечер (после 17)' },
      },
      ['service_id', 'date'],
    ),
  },
  {
    name: 'studio_info',
    scopes: ['client', 'owner'],
    description: 'Часы работы и особые дни, адрес, контакты или правила записи и отмены студии.',
    input_schema: obj({ topic: { type: 'string', enum: ['hours', 'address', 'contacts', 'policy'] } }, ['topic']),
  },
  {
    name: 'my_bookings',
    scopes: ['client'],
    description: 'Записи клиента на этом устройстве (предстоящие и последние). Пустой список, если клиент ещё не записывался с этого устройства.',
    input_schema: obj({}, []),
  },
  {
    name: 'propose_booking',
    scopes: ['client'],
    description:
      'Предложить клиенту конкретную запись. Сервер проверяет, что время свободно, и показывает клиенту кнопку подтверждения с итоговой ценой. Запись создаётся только после подтверждения клиентом, не этим вызовом.',
    input_schema: obj(
      {
        service_id: { type: 'string', description: 'id услуги из list_services' },
        starts_at: { type: 'string', description: 'starts_at одного из слотов check_availability (ISO 8601 со смещением)' },
        body_type: BODY_ENUM,
      },
      ['service_id', 'starts_at'],
    ),
  },
  {
    name: 'day_schedule',
    scopes: ['owner'],
    description: 'Расписание студии на день: записи по боксам (время, клиент, услуга, авто, статус) и блокировки.',
    input_schema: obj({ date: DATE('День') }, ['date']),
  },
  {
    name: 'find_customers',
    scopes: ['owner'],
    description: 'Поиск клиентов студии по имени или телефону: визиты, следующая запись, автомобили.',
    input_schema: obj({ query: { type: 'string', description: 'Имя или часть телефона' } }, ['query']),
  },
  {
    name: 'period_stats',
    scopes: ['owner'],
    description:
      'Статистика за период (включительно): записи, выполнено работ, получено оплат, средний чек, загрузка, новые клиенты. Запланированное, выполненное и полученное — разные величины, не складывай их.',
    input_schema: obj({ from: DATE('Начало периода'), to: DATE('Конец периода') }, ['from', 'to']),
  },
  {
    name: 'booking_by_code',
    scopes: ['owner'],
    description: 'Запись по шестизначному номеру (например, K7M2QX).',
    input_schema: obj({ code: { type: 'string', description: 'Номер записи' } }, ['code']),
  },
]

export function toolsForScope(scope: ToolScope): ToolSpec[] {
  return TOOL_SPECS.filter((t) => t.scopes.includes(scope))
}

export function isToolAllowed(name: string, scope: ToolScope): name is ToolName {
  return TOOL_SPECS.some((t) => t.name === name && t.scopes.includes(scope))
}

export type ParsedTool = { ok: true; name: ToolName; input: Record<string, unknown> } | { ok: false; error: string }

/** Scope check + Zod validation of a tool call coming from the model. */
export function parseToolCall(name: string, input: unknown, scope: ToolScope): ParsedTool {
  if (!isToolAllowed(name, scope)) return { ok: false, error: `Инструмент ${name} недоступен` }
  const r = toolInputs[name].safeParse(input ?? {})
  if (!r.success) return { ok: false, error: `Неверные параметры: ${r.error.issues.map((i) => `${i.path.join('.') || 'input'} — ${i.message}`).join('; ')}` }
  return { ok: true, name, input: r.data as Record<string, unknown> }
}

/** What the UI can do with an assistant answer (rendered as buttons, never auto-executed). */
export type AssistantAction =
  | { type: 'book'; service_id: string; starts_at: string; body_type: string | null; label: string; price_cents: number }
  | { type: 'open_booking'; booking_id: string; label: string }
  | { type: 'open_customer'; customer_id: string; label: string }
  | { type: 'open_url'; url: string; label: string }
  | { type: 'call'; phone: string; label: string }

export const chatRequestSchema = z.strictObject({
  scope: z.enum(['client', 'owner']),
  messages: z
    .array(z.strictObject({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]!.role === 'user', 'последнее сообщение должно быть от пользователя'),
})
export type ChatRequest = z.output<typeof chatRequestSchema>

export interface ChatResponse {
  mode: 'llm' | 'fallback'
  reply: string
  actions: AssistantAction[]
  /** Why the deterministic assistant answered instead of the LLM (shown honestly in the UI). */
  notice: 'not_configured' | 'budget_exhausted' | 'unavailable' | 'disabled' | null
}
