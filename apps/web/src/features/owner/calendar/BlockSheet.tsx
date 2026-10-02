import { zonedIso } from '@dp/core/time/zoned'
import { Lock } from 'lucide-react'
import { useId, useState } from 'react'
import { SheetFrame } from '@/components/SheetFrame'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api/http'
import { span, today, when } from '@/lib/format'
import { rpc, rows, supabase } from '../api/client'
import type { BlockReason } from '../api/types'
import { useCatalog, useOwner, useOwnerMutation } from '../data'
import { BLOCK_REASON_LABEL } from '../shared/labels'
import { useSheets } from '../shared/sheets'
import { DateInput, TimeInput } from '../shared/TimeField'
import { KindSwitch } from './CreateBookingSheet'
import { useQuery } from '@tanstack/react-query'

const REASONS = Object.keys(BLOCK_REASON_LABEL) as BlockReason[]

/** New block: the same occupancy ledger as bookings, so nobody can book over it. */
export function NewBlockSheet() {
  const { tenantId, tz } = useOwner()
  const sheets = useSheets()
  const id = useId()
  const catalog = useCatalog()
  const resources = (catalog.data?.resources ?? []).filter((r) => r.active)
  const [resource, setResource] = useState<string | undefined>(sheets.resource ?? undefined)
  const [day, setDay] = useState(sheets.day ?? today(tz))
  const [endDay, setEndDay] = useState(sheets.day ?? today(tz))
  const [from, setFrom] = useState(sheets.time ?? '10:00')
  const [to, setTo] = useState(() => {
    const [h, m] = (sheets.time ?? '10:00').split(':').map(Number) as [number, number]
    return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  })
  const [reason, setReason] = useState<BlockReason>('maintenance')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const startIso = zonedIso(day, from, tz)
  const endIso = zonedIso(endDay < day ? day : endDay, to, tz)
  const valid = Boolean(resource) && new Date(endIso) > new Date(startIso)
  const create = useOwnerMutation(() =>
    rpc<{ id: string }>('owner_create_block', {
      p_tenant: tenantId,
      p_resource_id: resource,
      p_starts_at: startIso,
      p_ends_at: endIso,
      p_reason: reason,
      p_title: title.trim() || null,
      p_note: note.trim() || null,
    }),
  )
  return (
    <SheetFrame title="Блокировка" onClose={sheets.close}>
      <KindSwitch current="block" />
      <div className="grid gap-4 px-4 pb-8">
        <Field id={`${id}-res`} label="Бокс / пост">
          {catalog.isPending ? (
            <Skeleton className="h-12 rounded-lg" />
          ) : (
            <Select value={resource ?? ''} onValueChange={setResource}>
              <SelectTrigger id={`${id}-res`}>
                <SelectValue placeholder="Выберите" />
              </SelectTrigger>
              <SelectContent>
                {resources.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id={`${id}-day`} label="С даты">
            <DateInput id={`${id}-day`} value={day} onChange={(e) => e.target.value && (setDay(e.target.value), endDay < e.target.value && setEndDay(e.target.value))} />
          </Field>
          <Field id={`${id}-from`} label="Время">
            <TimeInput id={`${id}-from`} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field id={`${id}-end`} label="По дату">
            <DateInput id={`${id}-end`} value={endDay} min={day} onChange={(e) => e.target.value && setEndDay(e.target.value)} />
          </Field>
          <Field id={`${id}-to`} label="Время">
            <TimeInput id={`${id}-to`} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {!valid && resource && <p className="text-sm text-danger">Конец должен быть позже начала</p>}
        <Field id={`${id}-reason`} label="Причина">
          <Select value={reason} onValueChange={(v) => setReason(v as BlockReason)}>
            <SelectTrigger id={`${id}-reason`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {BLOCK_REASON_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id={`${id}-title`} label="Название (необязательно)">
          <Input id={`${id}-title`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Замена ламп" />
        </Field>
        <Field id={`${id}-note`} label="Заметка">
          <Textarea id={`${id}-note`} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {create.error && <p role="alert" className="text-sm text-danger">{errorMessage(create.error)}</p>}
        <Button size="lg" block disabled={!valid} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: () => sheets.close() })}>
          <Lock /> Заблокировать
        </Button>
      </div>
    </SheetFrame>
  )
}

interface BlockRow {
  id: string
  resource_id: string
  block_reason: BlockReason
  title: string | null
  note: string | null
  during: string
  released_at: string | null
}

/** An existing block: what it is and the way to remove it. */
export function BlockDetailSheet({ id }: { id: string }) {
  const { tenantId, tz, locale, canManage } = useOwner()
  const sheets = useSheets()
  const catalog = useCatalog()
  const q = useQuery({
    queryKey: ['owner', tenantId, 'block', id],
    queryFn: async () => (await rows<BlockRow>(supabase().from('resource_occupancies').select('id,resource_id,block_reason,title,note,during,released_at').eq('tenant_id', tenantId).eq('id', id)))[0] ?? null,
  })
  const release = useOwnerMutation(() => rpc('owner_release_block', { p_occupancy: id }))
  const b = q.data
  const [start, end] = b ? (b.during.replace(/[[\]()"]/g, '').split(',') as [string, string]) : ['', '']
  return (
    <SheetFrame title="Блокировка" onClose={sheets.close}>
      <div className="grid gap-4 px-4 pb-8">
        {q.isPending ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : !b ? (
          <p className="text-sm text-fg-muted">Блокировка не найдена.</p>
        ) : (
          <>
            <div className="grid gap-1 rounded-2xl border border-line bg-surface p-4">
              <p className="font-semibold">{b.title || BLOCK_REASON_LABEL[b.block_reason]}</p>
              <p className="text-sm text-fg-muted">
                {catalog.data?.resources.find((r) => r.id === b.resource_id)?.name} · {BLOCK_REASON_LABEL[b.block_reason]}
              </p>
              <p className="text-sm first-letter:uppercase">{start.slice(0, 10) === end.slice(0, 10) ? `${when(start, tz, locale)}–${span(start, end, tz, locale).split('–')[1] ?? ''}` : `${when(start, tz, locale)} → ${when(end, tz, locale)}`}</p>
              {b.note && <p className="pt-1 text-sm whitespace-pre-wrap">{b.note}</p>}
              {b.released_at && <p className="pt-1 text-sm text-fg-muted">Снята.</p>}
            </div>
            {release.error && <p role="alert" className="text-sm text-danger">{errorMessage(release.error)}</p>}
            {canManage && !b.released_at && (
              <Button variant="danger" loading={release.isPending} onClick={() => release.mutate(undefined, { onSuccess: () => sheets.close() })}>
                Снять блокировку
              </Button>
            )}
          </>
        )}
      </div>
    </SheetFrame>
  )
}
