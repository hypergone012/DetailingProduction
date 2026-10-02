import { useToast } from '@astryxdesign/core/Toast'
import type { BookingStatus } from '@dp/core/api/contracts'
import { BODY_TYPE_LABELS } from '@dp/core/tenant/constants'
import { Ban, CalendarClock, Camera, CarFront, Clock, Link2, Mail, MessageSquareText, Phone, Trash2, UserRound, Warehouse } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { SheetFrame } from '@/components/SheetFrame'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api/http'
import { dateLong, money, phonePretty, span, when } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ownerFunction, rpc } from '../api/client'
import type { OwnerBooking } from '../api/types'
import { useBooking, useOwner, useOwnerMutation, useSignedUrls } from '../data'
import { ACTOR_LABEL, EVENT_LABEL, nextActions, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, SOURCE_LABEL, type PaymentMethod } from '../shared/labels'
import { MoneyInput } from '../shared/MoneyInput'
import { Row } from '../shared/Row'
import { useSheets } from '../shared/sheets'
import { deleteMedia, uploadImage } from '../shared/upload'

export function BookingSheet({ id }: { id: string }) {
  const sheets = useSheets()
  const q = useBooking(id)
  return (
    <SheetFrame title={q.data ? `Запись ${q.data.code}` : 'Запись'} onClose={sheets.close}>
      {q.isPending ? (
        <div className="grid gap-3 px-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : q.isError ? (
        <p className="px-4 text-sm text-danger">{errorMessage(q.error)}</p>
      ) : (
        <BookingBody b={q.data} />
      )}
    </SheetFrame>
  )
}

function BookingBody({ b }: { b: OwnerBooking }) {
  const { tz, locale, slug, canManage } = useOwner()
  const sheets = useSheets()
  const showToast = useToast()
  const active = b.status === 'pending' || b.status === 'confirmed' || b.status === 'in_progress'
  const setStatus = useOwnerMutation((status: BookingStatus) => rpc('owner_set_booking_status', { p_booking: b.id, p_status: status }))
  const paid = b.paid_cents ?? 0
  const due = Math.max(0, b.price_cents - paid)

  return (
    <div className="grid gap-5 px-4 pb-8">
      <div className="grid gap-2 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={b.status} />
          {b.is_demo && <Badge tone="warning">Демо</Badge>}
          <Badge tone="neutral">{SOURCE_LABEL[b.source]}</Badge>
        </div>
        <p className="text-lg font-semibold first-letter:uppercase">{dateLong(b.starts_at, tz, locale)}</p>
        <p className="flex items-center gap-2 text-fg-muted">
          <Clock className="size-4" aria-hidden />
          {b.multi_day ? `${when(b.starts_at, tz, locale)} → ${when(b.ends_at, tz, locale)}` : span(b.starts_at, b.ends_at, tz, locale)}
        </p>
        {setStatus.error && <p role="alert" className="text-sm text-danger">{errorMessage(setStatus.error)}</p>}
        {canManage || b.status !== 'pending' ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {nextActions(b.status).map((a) => (
              <Button key={a.status} size="sm" variant={a.primary ? 'primary' : 'secondary'} loading={setStatus.isPending && setStatus.variables === a.status} onClick={() => setStatus.mutate(a.status)}>
                {a.label}
              </Button>
            ))}
            {canManage && b.can_modify && (
              <Button size="sm" variant="secondary" onClick={() => sheets.replace({ booking: b.id, move: '1' })}>
                <CalendarClock /> Перенести
              </Button>
            )}
          </div>
        ) : null}
      </div>

      <section className="grid divide-y divide-line rounded-2xl border border-line bg-surface px-4">
        <Row icon={<UserRound />} label="Клиент">
          <Link to={`/s/${slug}/owner/customers/${b.customer.id}`} className="font-medium text-accent-text underline-offset-4 hover:underline">
            {b.customer.name}
          </Link>
        </Row>
        {b.customer.phone && (
          <Row icon={<Phone />} label="Телефон">
            <a href={`tel:${b.customer.phone}`} className="tabular underline-offset-4 hover:underline">
              {phonePretty(b.customer.phone)}
            </a>
          </Row>
        )}
        {b.customer.email && (
          <Row icon={<Mail />} label="Email">
            <a href={`mailto:${b.customer.email}`} className="underline-offset-4 hover:underline">
              {b.customer.email}
            </a>
          </Row>
        )}
        {b.vehicle && (
          <Row icon={<CarFront />} label="Автомобиль">
            {b.vehicle.make} {b.vehicle.model}
            {b.vehicle.year ? `, ${b.vehicle.year}` : ''} · {BODY_TYPE_LABELS[b.vehicle.body_type]}
            {b.vehicle.plate && <span className="ml-1 rounded bg-sunken px-1.5 py-0.5 text-xs font-semibold tabular">{b.vehicle.plate}</span>}
          </Row>
        )}
        {b.resource && (
          <Row icon={<Warehouse />} label="Ресурс">
            {b.resource.name}
          </Row>
        )}
        {b.customer_note && (
          <Row icon={<MessageSquareText />} label="Комментарий клиента">
            <span className="whitespace-pre-wrap">{b.customer_note}</span>
          </Row>
        )}
      </section>

      <PriceSection b={b} />
      {b.money_visible && canManage && b.status !== 'cancelled' && <PaymentSection b={b} due={due} />}
      <NotesSection b={b} />
      <PhotosSection b={b} />
      {canManage && <ShareLink b={b} onCopied={() => showToast({ body: 'Ссылка скопирована' })} />}
      <History b={b} />
      {canManage && active && <CancelSection b={b} />}
    </div>
  )
}

function PriceSection({ b }: { b: OwnerBooking }) {
  const { locale, canManage } = useOwner()
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [price, setPrice] = useState<number | null>(b.price_cents)
  const [reason, setReason] = useState('')
  const save = useOwnerMutation(() => rpc('owner_update_booking', { p_booking: b.id, p_patch: { price_cents: price, price_reason: reason } }))
  const paid = b.paid_cents
  return (
    <section className="grid gap-2 rounded-2xl border border-line bg-surface p-4">
      {b.items.map((i, n) => (
        <div key={n} className="flex justify-between gap-3 text-sm">
          <span className={cn('text-fg-muted', i.kind === 'adjustment' && 'italic')}>{i.name}</span>
          <span className="tabular">{money(i.price_cents, b.currency, locale)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t border-line pt-2 font-semibold">
        <span>Итого</span>
        <span className="tabular">{money(b.price_cents, b.currency, locale)}</span>
      </div>
      {paid !== undefined && (
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-fg-muted">Оплачено</span>
          <span className={cn('tabular', paid >= b.price_cents ? 'text-success' : 'text-fg')}>{money(paid, b.currency, locale)}</span>
        </div>
      )}
      <p className="text-xs text-fg-subtle">Цена зафиксирована при записи; изменение прайса её не меняет.</p>
      {canManage && b.status !== 'cancelled' && b.status !== 'no_show' && (
        editing ? (
          <form
            className="grid gap-3 pt-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (price === null || price < 0) return
              save.mutate(undefined, { onSuccess: () => setEditing(false) })
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field id={`${id}-price`} label="Новая цена, ₽">
                <MoneyInput id={`${id}-price`} cents={price} onCents={setPrice} />
              </Field>
              <Field id={`${id}-reason`} label="Причина">
                <Input id={`${id}-reason`} value={reason} maxLength={120} placeholder="Скидка, доп. работы" onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={save.isPending} disabled={price === null || price === b.price_cents}>
                Сохранить цену
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Отмена
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => (setPrice(b.price_cents), setEditing(true))}>
            Изменить цену
          </Button>
        )
      )}
    </section>
  )
}

function PaymentSection({ b, due }: { b: OwnerBooking; due: number }) {
  const { tenantId, tz, locale } = useOwner()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState<number | null>(due || null)
  const [method, setMethod] = useState<PaymentMethod>('card')
  const [refund, setRefund] = useState(false)
  // One key per opened form: a double tap or a retry after a timeout records one payment.
  const [key, setKey] = useState(() => crypto.randomUUID())
  const record = useOwnerMutation(() =>
    rpc('owner_record_payment', {
      p_tenant: tenantId,
      p_payment: { booking_id: b.id, kind: refund ? 'refund' : 'payment', method, amount_cents: amount, idempotency_key: key },
    }),
  )
  return (
    <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Оплаты</h3>
        {!open && (
          <Button size="sm" variant="secondary" onClick={() => (setAmount(due || null), setRefund(false), setKey(crypto.randomUUID()), setOpen(true))}>
            Записать оплату
          </Button>
        )}
      </div>
      {(b.payments ?? []).length === 0 && !open && <p className="text-sm text-fg-muted">Оплат пока нет{due > 0 ? ` · к оплате ${money(due, b.currency, locale)}` : ''}.</p>}
      {(b.payments ?? []).map((p) => (
        <div key={p.id} className="flex justify-between gap-3 text-sm">
          <span className="text-fg-muted">
            {when(p.paid_at, tz, locale)} · {PAYMENT_METHOD_LABEL[p.method]}
            {p.kind === 'refund' && ' · возврат'}
          </span>
          <span className={cn('tabular', p.kind === 'refund' && 'text-danger')}>
            {p.kind === 'refund' ? '−' : ''}
            {money(p.amount_cents, b.currency, locale)}
          </span>
        </div>
      ))}
      {open && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!amount || amount <= 0) return
            record.mutate(undefined, { onSuccess: () => setOpen(false) })
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-amount`} label="Сумма, ₽">
              <MoneyInput id={`${id}-amount`} cents={amount} onCents={setAmount} />
            </Field>
            <Field id={`${id}-method`} label="Способ">
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id={`${id}-method`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={refund} onCheckedChange={setRefund} /> Это возврат клиенту
          </label>
          {record.error && <p role="alert" className="text-sm text-danger">{errorMessage(record.error)}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={record.isPending} disabled={!amount || amount <= 0}>
              {refund ? 'Записать возврат' : 'Записать оплату'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

function NotesSection({ b }: { b: OwnerBooking }) {
  const { canManage } = useOwner()
  const id = useId()
  const [internal, setInternal] = useState(b.internal_note)
  const [client, setClient] = useState(b.client_note)
  const save = useOwnerMutation((patch: Record<string, string>) => rpc('owner_update_booking', { p_booking: b.id, p_patch: patch }))
  const dirty = internal !== b.internal_note || client !== b.client_note
  if (!canManage) {
    return b.internal_note ? (
      <section className="grid gap-1 rounded-2xl border border-line bg-surface p-4 text-sm">
        <span className="text-xs text-fg-subtle">Заметка студии</span>
        <p className="whitespace-pre-wrap">{b.internal_note}</p>
      </section>
    ) : null
  }
  return (
    <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
      <Field id={`${id}-internal`} label="Заметка студии" hint="Видна только сотрудникам">
        <Textarea id={`${id}-internal`} value={internal} maxLength={4000} onChange={(e) => setInternal(e.target.value)} placeholder="Сколы на капоте, клиент просил не трогать…" />
      </Field>
      <Field id={`${id}-client`} label="Сообщение клиенту" hint="Клиент увидит его в своей записи">
        <Textarea id={`${id}-client`} value={client} maxLength={2000} onChange={(e) => setClient(e.target.value)} placeholder="Например, что взять с собой" />
      </Field>
      {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
      {dirty && (
        <Button size="sm" className="justify-self-start" loading={save.isPending} onClick={() => save.mutate({ internal_note: internal, client_note: client })}>
          Сохранить заметки
        </Button>
      )}
    </section>
  )
}

function PhotosSection({ b }: { b: OwnerBooking }) {
  const { tenantId, canManage } = useOwner()
  const fileRef = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<'before' | 'after'>('before')
  const [error, setError] = useState<string | null>(null)
  const photos = b.media.filter((m) => m.kind === 'before' || m.kind === 'after')
  const urls = useSignedUrls(photos.map((p) => p.path))
  const upload = useOwnerMutation(async (file: File) => {
    const up = await uploadImage(tenantId, 'private-media', `bookings/${b.id}`, file)
    await rpc('owner_register_media', {
      p_tenant: tenantId,
      p_media: { kind, bucket: 'private-media', path: up.path, width: up.width, height: up.height, booking_id: b.id, vehicle_id: b.vehicle?.id ?? null, client_visible: true },
    })
  })
  const remove = useOwnerMutation((mediaId: string) => deleteMedia(mediaId))
  if (!canManage && photos.length === 0) return null
  return (
    <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Фото до и после</h3>
        {canManage && (
          <div className="flex gap-1">
            {(['before', 'after'] as const).map((k) => (
              <Button
                key={k}
                size="sm"
                variant="secondary"
                loading={upload.isPending && kind === k}
                onClick={() => {
                  setKind(k)
                  setError(null)
                  fileRef.current?.click()
                }}
              >
                <Camera /> {k === 'before' ? 'До' : 'После'}
              </Button>
            ))}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload.mutate(f, { onError: (err) => setError(errorMessage(err)) })
                e.target.value = ''
              }}
            />
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {photos.length === 0 ? (
        <p className="text-sm text-fg-muted">Фото появятся в истории автомобиля у клиента.</p>
      ) : (
        <div className="scroll-x -mx-4 flex gap-2 px-4">
          {photos.map((p) => (
            <figure key={p.id} className="relative shrink-0">
              {urls.data?.[p.path] ? (
                <img src={urls.data[p.path]} alt={p.kind === 'before' ? 'До' : 'После'} className="h-28 w-36 rounded-lg object-cover" loading="lazy" />
              ) : (
                <Skeleton className="h-28 w-36 rounded-lg" />
              )}
              <figcaption className="mt-1 text-xs text-fg-subtle">{p.kind === 'before' ? 'До' : 'После'}</figcaption>
              {canManage && (
                <Button size="icon-sm" variant="secondary" className="absolute top-1 right-1" aria-label="Удалить фото" loading={remove.isPending && remove.variables === p.id} onClick={() => remove.mutate(p.id)}>
                  <Trash2 />
                </Button>
              )}
            </figure>
          ))}
        </div>
      )}
    </section>
  )
}

function ShareLink({ b, onCopied }: { b: OwnerBooking; onCopied: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const make = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await ownerFunction<{ url: string }>(`/bookings/${b.id}/share-link`, { method: 'POST' })
      setUrl(r.url)
      if (navigator.share) {
        await navigator.share({ title: `Запись ${b.code}`, url: r.url }).catch(() => undefined)
      } else {
        await navigator.clipboard?.writeText(r.url)
        onCopied()
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="grid gap-2 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 className="font-semibold">Ссылка для клиента</h3>
          <p className="text-sm text-fg-muted">Клиент увидит запись, добавит её в календарь и сможет перенести или отменить.</p>
        </div>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void make()}>
          <Link2 /> Создать
        </Button>
      </div>
      {url && <Input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Ссылка на запись" className="text-sm" />}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  )
}

function History({ b }: { b: OwnerBooking }) {
  const { tz, locale } = useOwner()
  return (
    <section className="grid gap-2 px-1">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">История</h3>
      <ol className="grid gap-1.5 text-sm">
        {b.events.map((e, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>
              {EVENT_LABEL[e.event] ?? e.event}
              <span className="text-fg-subtle"> · {ACTOR_LABEL[e.actor] ?? e.actor}</span>
            </span>
            <span className="shrink-0 text-fg-muted tabular">{when(e.at, tz, locale)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function CancelSection({ b }: { b: OwnerBooking }) {
  const sheets = useSheets()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const cancel = useOwnerMutation(() => rpc('owner_cancel_booking', { p_booking: b.id, p_reason: reason.trim() || null }))
  if (!open) {
    return (
      <Button variant="ghost" className="justify-self-center text-danger" onClick={() => setOpen(true)}>
        <Ban /> Отменить запись
      </Button>
    )
  }
  return (
    <section className="grid gap-3 rounded-2xl border border-danger/40 bg-danger-subtle p-4">
      <p className="font-semibold">Отменить запись {b.code}?</p>
      <p className="text-sm text-fg-muted">Время освободится сразу. {b.is_demo ? 'Демо-запись: клиент уведомление не получит.' : 'Клиент получит уведомление, если включил его.'}</p>
      <Field id={`${id}-reason`} label="Причина (необязательно)">
        <Input id={`${id}-reason`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {cancel.error && <p role="alert" className="text-sm text-danger">{errorMessage(cancel.error)}</p>}
      <div className="flex gap-2">
        <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSuccess: () => sheets.close() })}>
          Отменить запись
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Не отменять
        </Button>
      </div>
    </section>
  )
}
