/**
 * Deterministic assistant: JSON intent (packages/core/src/ai/intent.ts) -> the same tool
 * executors the LLM uses -> a short templated answer with action buttons. Used when no LLM
 * is configured, the daily budget is spent, or the LLM call fails.
 */
import type { AssistantAction } from '../_vendor/core/ai/tools.ts'
import { routeClientIntent, routeOwnerIntent, type ServiceRef } from '../_vendor/core/ai/intent.ts'
import { addDaysIso } from '../_vendor/core/ai/dates.ts'
import { BODY_TYPE_LABELS, type BodyType } from '../_vendor/core/tenant/constants.ts'
import { execute, type Scope } from './executors.ts'
import { formatMoney, labelWhen } from './format.ts'

const WEEKDAY = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

interface Answer {
  reply: string
  actions: AssistantAction[]
}

const answer = (reply: string, actions: AssistantAction[] = []): Answer => ({ reply, actions })

function serviceRefs(scope: Scope): ServiceRef[] {
  return scope.data.services.map((s) => ({ id: s.id, name: s.name, category: s.category, summary: s.summary }))
}

function servicesLine(scope: Scope): string {
  const { data } = scope
  return data.services
    .slice(0, 8)
    .map((s) => `${s.name} — ${s.variants.length ? 'от ' : ''}${formatMoney(Math.min(s.price_cents, ...s.variants.map((v) => v.price_cents)), data.tenant.currency)}`)
    .join('\n')
}

export async function fallbackAnswer(scope: Scope, text: string, today: string): Promise<Answer> {
  return scope.kind === 'owner' ? ownerAnswer(scope, text, today) : clientAnswer(scope, text, today)
}

async function clientAnswer(scope: Scope, text: string, today: string): Promise<Answer> {
  const { data } = scope
  const intent = routeClientIntent(text, { today, services: serviceRefs(scope) })
  switch (intent.type) {
    case 'book': {
      const service = data.services.find((s) => s.id === intent.serviceId)
      if (!service) return answer(`На какую услугу записать?\n${servicesLine(scope)}`)
      const from = intent.day ?? today
      const out = await execute(scope, 'check_availability', { service_id: service.id, date: from, days: intent.day ? 1 : 3, body_type: intent.bodyType, part_of_day: intent.part })
      const r = out.result as { price: string; slots: { starts_at: string; label: string }[] }
      if (r.slots.length === 0) {
        return answer(`На «${service.name}» ${intent.day ? `на ${labelWhen(`${from}T12:00:00Z`, data.tenant.timezone, 'date')}` : 'в ближайшие дни'} свободного времени нет${intent.part ? ' в это время суток' : ''}. Посмотрите другие даты в записи.`)
      }
      const exact = intent.time ? r.slots.find((s) => labelWhen(s.starts_at, data.tenant.timezone, 'time') === intent.time) : undefined
      const picks = exact ? [exact] : r.slots.slice(0, 4)
      const actions: AssistantAction[] = []
      for (const s of picks) {
        const p = await execute(scope, 'propose_booking', { service_id: service.id, starts_at: s.starts_at, body_type: intent.bodyType }).catch(() => null)
        if (p) actions.push(...p.actions)
      }
      const priceNote = intent.bodyType ? `для типа «${BODY_TYPE_LABELS[intent.bodyType as BodyType]}» ${r.price}` : `${service.variants.length ? 'от ' : ''}${r.price}${service.variants.length ? ' (цена зависит от кузова)' : ''}`
      const lead = exact ? `Время ${intent.time} свободно.` : intent.time ? `${intent.time} занято, есть ближайшие варианты:` : 'Свободное время:'
      return answer(`${lead} «${service.name}» — ${priceNote}. Нажмите на вариант, чтобы подтвердить запись.`, actions)
    }
    case 'prices': {
      const service = data.services.find((s) => s.id === intent.serviceId)
      if (!service) return answer(`Цены:\n${servicesLine(scope)}`)
      const variant = intent.bodyType ? service.variants.find((v) => v.body_type === intent.bodyType) : undefined
      const base = variant ? formatMoney(variant.price_cents, data.tenant.currency) : formatMoney(service.price_cents, data.tenant.currency)
      const lines = [`«${service.name}» — ${variant || !service.variants.length ? base : `от ${formatMoney(Math.min(service.price_cents, ...service.variants.map((v) => v.price_cents)), data.tenant.currency)}`}.`]
      if (!variant && service.variants.length) lines.push(service.variants.map((v) => `${BODY_TYPE_LABELS[v.body_type]}: ${formatMoney(v.price_cents, data.tenant.currency)}`).join(', ') + '.')
      return answer(lines.join(' '))
    }
    case 'services':
      return answer(`Услуги студии:\n${servicesLine(scope)}`)
    case 'hours': {
      const days = [1, 2, 3, 4, 5, 6, 7].map((d) => {
        const ws = data.hours.filter((h) => h.weekday === d)
        return `${WEEKDAY[d]}: ${ws.length ? ws.map((w) => `${w.opens.slice(0, 5)}–${w.closes.slice(0, 5)}`).join(', ') : 'выходной'}`
      })
      const soon = data.exceptions.filter((x) => x.day >= today && x.day <= addDaysIso(today, 14))
      const extra = soon.length ? `\nОсобые дни: ${soon.map((x) => `${x.day} — ${x.closed ? 'выходной' : `${x.opens?.slice(0, 5)}–${x.closes?.slice(0, 5)}`}`).join('; ')}` : ''
      return answer(`Часы работы (${data.tenant.timezone}):\n${days.join('\n')}${extra}`)
    }
    case 'address': {
      const out = await execute(scope, 'studio_info', { topic: 'address' })
      return answer(data.profile.address ? `Адрес: ${data.profile.address}.` : 'Адрес студия пока не указала.', out.actions)
    }
    case 'contacts': {
      const out = await execute(scope, 'studio_info', { topic: 'contacts' })
      return answer(data.profile.phone ? `Телефон студии: ${data.profile.phone}.` : 'Студия пока не указала телефон.', out.actions)
    }
    case 'my_bookings': {
      const out = await execute(scope, 'my_bookings', {})
      const r = out.result as { bookings: { code: string; service: string; when: string; status: string }[] }
      if (!r.bookings.length) return answer('На этом устройстве записей пока нет.')
      return answer(`Ваши записи:\n${r.bookings.map((b) => `${b.when} — ${b.service} (№ ${b.code})`).join('\n')}`, out.actions)
    }
    case 'cancel':
    case 'reschedule': {
      const out = await execute(scope, 'my_bookings', {})
      return answer(
        `${intent.type === 'cancel' ? 'Отменить' : 'Перенести'} запись можно в её карточке (раздел «История»), не позднее чем за ${data.policy.cancel_cutoff_hours} ч до начала. Позже — по телефону студии.`,
        out.actions,
      )
    }
    case 'greeting':
      return answer(`Здравствуйте! Помогу записаться в «${data.tenant.name}», подскажу цены и свободное время. Например: «мойка завтра вечером».`)
    default:
      return answer('Я помогаю с записью: напишите услугу и удобное время, например «химчистка в субботу утром», или спросите о ценах и адресе.')
  }
}

async function ownerAnswer(scope: Scope, text: string, today: string): Promise<Answer> {
  const intent = routeOwnerIntent(text, { today, services: serviceRefs(scope) })
  const { data } = scope
  switch (intent.type) {
    case 'day_schedule': {
      const out = await execute(scope, 'day_schedule', { date: intent.day })
      const r = out.result as { open: boolean; items: { time: string; customer?: string; service?: string; resource?: string; block?: string }[] }
      if (!r.items.length) return answer(`${intent.day}: ${r.open ? 'записей нет' : 'выходной по расписанию'}.`)
      return answer(`${intent.day}:\n${r.items.map((i) => (i.customer ? `${i.time} ${i.customer} — ${i.service} (${i.resource})` : `${i.time} блокировка ${i.block} (${i.resource})`)).join('\n')}`, out.actions)
    }
    case 'stats': {
      const from = addDaysIso(today, -(intent.days - 1))
      const out = await execute(scope, 'period_stats', { from, to: today })
      const s = out.result as { money_visible: boolean; currency: string; completed: { count: number; value_cents: number | null }; payments: { received_cents: number } | null; scheduled: { count: number } }
      const money = s.money_visible
        ? ` Выполнено работ на ${formatMoney(s.completed.value_cents ?? 0, s.currency)}, получено оплат ${formatMoney(s.payments?.received_cents ?? 0, s.currency)}.`
        : ' Суммы видны только менеджеру и владельцу.'
      return answer(`За ${intent.days === 1 ? 'сегодня' : `${intent.days} дн.`}: записей ${s.scheduled.count}, выполнено ${s.completed.count}.${money}`)
    }
    case 'find_customer': {
      const out = await execute(scope, 'find_customers', { query: intent.query })
      const r = out.result as { customers: { name: string; phone: string | null; visits: number; next_visit: string | null }[] }
      if (!r.customers.length) return answer(`Клиентов по запросу «${intent.query}» не нашлось.`)
      return answer(r.customers.slice(0, 5).map((c) => `${c.name}${c.phone ? `, ${c.phone}` : ''} — визитов ${c.visits}${c.next_visit ? `, следующий ${c.next_visit}` : ''}`).join('\n'), out.actions)
    }
    case 'free_slots': {
      const service = data.services.find((s) => s.id === intent.serviceId)
      if (!service) return answer(`Для какой услуги искать время?\n${servicesLine(scope)}`)
      const out = await execute(scope, 'check_availability', { service_id: service.id, date: intent.day, days: 1 })
      const r = out.result as { slots: { label: string }[] }
      return answer(r.slots.length ? `«${service.name}», ${intent.day}: ${r.slots.slice(0, 12).map((s) => s.label.split(', ').pop()).join(', ')}` : `«${service.name}», ${intent.day}: свободного времени нет.`)
    }
    case 'pending': {
      const days = [0, 1, 2, 3, 4, 5, 6].map((d) => addDaysIso(today, d))
      const lines: string[] = []
      const actions: AssistantAction[] = []
      for (const d of days) {
        const out = await execute(scope, 'day_schedule', { date: d })
        const r = out.result as { items: { status?: string; time: string; customer?: string; service?: string }[] }
        for (const i of r.items.filter((x) => x.status === 'pending')) lines.push(`${d} ${i.time} ${i.customer} — ${i.service}`)
        actions.push(...out.actions)
      }
      return answer(lines.length ? `Ждут подтверждения:\n${lines.join('\n')}` : 'Неподтверждённых записей на неделю нет.', lines.length ? actions.slice(0, 3) : [])
    }
    default:
      return answer('Могу показать расписание на день («кто записан завтра»), свободные окна, найти клиента или показать статистику за неделю или месяц.')
  }
}
