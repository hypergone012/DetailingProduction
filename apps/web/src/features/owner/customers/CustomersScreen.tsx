import { BottomSheet } from '@astryxdesign/core/BottomSheet'
import { ChevronRight, UserPlus, Users } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { EmptyState } from '@/components/Section'
import { ScreenHeader } from '@/components/ScreenHeader'
import { SheetFrame } from '@/components/SheetFrame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/http'
import { dateShort, phonePretty, plural, when } from '@/lib/format'
import { useCustomers, useOwner } from '../data'
import { CustomerForm } from './CustomerForm'

export function CustomersScreen() {
  const { slug, tz, locale, canManage } = useOwner()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const term = useDeferredValue(q)
  const list = useCustomers(term)
  const [adding, setAdding] = useState(false)
  return (
    <>
      <ScreenHeader
        title="Клиенты"
        large
        wide
        actions={
          canManage && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <UserPlus /> Клиент
            </Button>
          )
        }
      />
      <div className="mx-auto grid max-w-3xl gap-4 px-4 pb-8">
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени или телефону" aria-label="Поиск клиентов" />
        {list.isPending ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : list.isError ? (
          <p className="text-sm text-danger">{errorMessage(list.error)}</p>
        ) : list.data.length === 0 ? (
          <EmptyState icon={<Users />} title={term ? 'Никого не нашли' : 'Клиентов пока нет'} text={term ? 'Проверьте написание или поищите по последним цифрам телефона.' : 'Клиенты появятся после первой онлайн-записи или когда вы добавите их сами.'} />
        ) : (
          <ul className="grid divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {list.data.map((c) => (
              <li key={c.id}>
                <Link to={`/s/${slug}/owner/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-surface-2 focus-visible:bg-surface-2">
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex items-center gap-2 truncate font-medium">
                      {c.name}
                      {c.is_demo && <Badge tone="warning">демо</Badge>}
                    </span>
                    <span className="truncate text-sm text-fg-muted">
                      {phonePretty(c.phone_e164) || 'без телефона'} · {c.completed_count} {plural(c.completed_count, 'визит', 'визита', 'визитов')}
                      {c.vehicles_count ? ` · авто ${c.vehicles_count}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-fg-subtle">
                    {c.next_visit_at ? <span className="text-accent-text">{when(c.next_visit_at, tz, locale)}</span> : c.last_visit_at ? `был ${dateShort(c.last_visit_at, tz, locale)}` : ''}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <BottomSheet isOpen={adding} onOpenChange={setAdding} label="Новый клиент" height="tall" purpose="form">
        {adding && (
          <SheetFrame title="Новый клиент" onClose={() => setAdding(false)}>
            <div className="px-4 pb-8">
              <CustomerForm onSaved={(id) => (setAdding(false), navigate(`/s/${slug}/owner/customers/${id}`))} />
            </div>
          </SheetFrame>
        )}
      </BottomSheet>
    </>
  )
}
