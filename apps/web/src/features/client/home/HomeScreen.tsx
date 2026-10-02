import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, ChevronRight, Clock, MapPin, Phone, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { Img } from '@/components/Img'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { duration, money, phonePretty, today, when } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Stagger, StaggerItem } from '@/motion/Stagger'
import { useTenant } from '@/tenant/TenantProvider'
import { useBookingFlow } from '../booking/flow'
import { hasPriceRange, isUpcoming, keys, minPrice, useProfile } from '../data'
import { suggestionText } from '../garage/suggestions'
import { Card, Section } from '@/components/Section'
import { StatusBadge } from '@/components/StatusBadge'
import { VehicleGlyph } from '@/components/VehicleGlyph'
import { WEEKDAY_NAMES, openStatus } from '../shared/hours'

export function HomeScreen() {
  const { data } = useTenant()
  return (
    <div className="mx-auto grid max-w-xl gap-6 pb-8">
      <StudioHero />
      <div className="grid gap-6 px-4">
        <BookNowCard />
        <UpcomingBooking />
        <GarageGlance />
        <PopularServices />
        {data.media.some((m) => m.kind === 'gallery') && <Gallery />}
        <About />
      </div>
    </div>
  )
}

function StudioHero() {
  const { data, mediaByKey, mediaFor } = useTenant()
  const hero = mediaByKey(data.branding.heroKey) ?? mediaFor('hero')[0]
  const logo = mediaByKey(data.branding.logoKey) ?? mediaFor('logo')[0]
  const status = openStatus(data)
  return (
    <header className="relative">
      <div className="relative aspect-[16/9] max-h-[320px] w-full overflow-hidden bg-sunken">
        <Img media={hero} priority sizes="(max-width: 640px) 100vw, 640px" className="size-full" alt={data.branding.heroAlt ?? ''} />
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-bg to-transparent" aria-hidden />
      </div>
      <div className="relative -mt-8 grid gap-2 px-4">
        <div className="flex items-center gap-3">
          {logo?.url && <img src={logo.url} alt="" className="size-14 shrink-0 rounded-2xl border border-line bg-surface object-contain p-2 shadow-sm" />}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-[26px] leading-tight font-semibold text-balance">{data.tenant.name}</h1>
            {data.tenant.status === 'demo' && <Badge tone="warning">Демо</Badge>}
          </div>
        </div>
        {data.profile.tagline && <p className="text-[15px] text-fg-muted">{data.profile.tagline}</p>}
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className={cn('size-2 shrink-0 rounded-full', status.open ? 'bg-success' : 'bg-fg-subtle')} aria-hidden />
          <span className={cn('shrink-0', status.open ? 'text-fg' : 'text-fg-muted')}>{status.text}</span>
          {data.profile.address && <span className="truncate text-fg-subtle">· {data.profile.address.split(',')[0]}</span>}
        </p>
      </div>
    </header>
  )
}

/** Booking first: one tap to start, with the real nearest free time from the server. */
function BookNowCard() {
  const { slug, api, data, tz, currency, locale } = useTenant()
  const flow = useBookingFlow()
  const { profile } = useProfile()
  const lastServiceId = profile?.bookings.find((b) => b.status === 'completed')?.service_id
  const featured = data.services.find((s) => s.id === lastServiceId) ?? data.services[0]
  const vehicle = profile?.vehicles[0]
  const nearest = useQuery({
    queryKey: keys.availability(slug, { nearest: featured?.id, body: vehicle?.body_type }),
    queryFn: () => api.availability({ serviceId: featured!.id, bodyType: vehicle?.body_type, from: today(tz), days: 7 }),
    enabled: Boolean(featured),
    staleTime: 60_000,
  })
  const first = nearest.data?.slots[0]
  return (
    <Card className="grid gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Записаться онлайн</h2>
          <p className="text-sm text-fg-muted">Точная цена и свободное время — сразу, без звонка.</p>
        </div>
        <CalendarClock className="size-6 shrink-0 text-accent-text" aria-hidden />
      </div>
      {featured && (
        <div className="flex items-center gap-2 rounded-xl bg-sunken px-3 py-2.5 text-sm">
          <Clock className="size-4 shrink-0 text-fg-muted" aria-hidden />
          {nearest.isPending ? (
            <Skeleton className="h-4 w-48" />
          ) : first ? (
            <span>
              Ближайшее на «{featured.name}»: <b className="font-semibold">{when(first.starts_at, tz, locale)}</b>
            </span>
          ) : (
            <span className="text-fg-muted">На неделю вперёд на «{featured.name}» мест нет — посмотрите другие даты</span>
          )}
        </div>
      )}
      <Button size="lg" block onClick={() => flow.start(vehicle ? { vehicle: { kind: 'saved', id: vehicle.id, body_type: vehicle.body_type, label: vehicle.nickname || `${vehicle.make} ${vehicle.model}` } } : {})}>
        Выбрать услугу и время <ArrowRight />
      </Button>
      <div className="scroll-x -mx-4 flex gap-2 px-4">
        {data.services.slice(0, 5).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => flow.start({ serviceId: s.id, ...(vehicle ? { vehicle: { kind: 'saved' as const, id: vehicle.id, body_type: vehicle.body_type, label: vehicle.nickname || `${vehicle.make} ${vehicle.model}` } } : {}) })}
            className="pressable shrink-0 snap-start rounded-full border border-line bg-bg-elevated px-3.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {s.name} <span className="text-fg-subtle tabular">· {hasPriceRange(s) ? 'от ' : ''}{money(minPrice(s), currency, locale)}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

function UpcomingBooking() {
  const { slug, tz, locale } = useTenant()
  const { profile } = useProfile()
  const next = profile?.bookings.filter(isUpcoming).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
  if (!next) return null
  const vehicle = profile?.vehicles.find((v) => v.id === next.vehicle_id)
  return (
    <Section title="Ваша запись">
      <Link to={`/s/${slug}/history/${next.id}`} className="pressable block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <Card className="flex items-center gap-4 border-accent-text/40 p-4">
          <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg">
            <span className="text-[11px] uppercase leading-none">{new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'short' }).format(new Date(next.starts_at)).replace('.', '')}</span>
            <span className="text-xl leading-none font-semibold tabular">{new Intl.DateTimeFormat(locale, { timeZone: tz, day: 'numeric' }).format(new Date(next.starts_at))}</span>
          </div>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <p className="truncate font-semibold">{next.service_name}</p>
            <p className="text-sm text-fg-muted first-letter:uppercase">
              {when(next.starts_at, tz, locale)}
              {vehicle ? ` · ${vehicle.nickname || vehicle.model}` : ''}
            </p>
            <div>
              <StatusBadge status={next.status} />
            </div>
          </div>
          <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
        </Card>
      </Link>
    </Section>
  )
}

function GarageGlance() {
  const { slug } = useTenant()
  const flow = useBookingFlow()
  const { profile, isFetching } = useProfile()
  const vehicles = profile?.vehicles ?? []
  if (!profile && isFetching) return <Skeleton className="h-28 w-full rounded-2xl" />
  if (vehicles.length === 0) {
    return (
      <Section title="Мой гараж">
        <Link to={`/s/${slug}/garage`} className="pressable block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <Card className="flex items-center gap-4 p-4">
            <VehicleGlyph className="h-10 w-20 shrink-0" />
            <div className="grid flex-1 gap-0.5 text-sm">
              <p className="font-medium">Добавьте автомобиль</p>
              <p className="text-fg-muted">Цены сразу для вашего кузова и история обслуживания в одном месте.</p>
            </div>
            <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
          </Card>
        </Link>
      </Section>
    )
  }
  return (
    <Section title="Мой гараж" action={<Link className="text-sm text-accent-text" to={`/s/${slug}/garage`}>Все</Link>}>
      <Stagger className="grid gap-3">
        {vehicles.slice(0, 2).map((v) => {
          const tip = v.suggestions[0]
          return (
            <StaggerItem key={v.id}>
              <Card className="grid gap-3 p-4">
                <Link to={`/s/${slug}/garage/${v.id}`} className="flex items-center gap-3 outline-none">
                  {v.photo?.url ? <img src={v.photo.url} alt="" className="size-12 rounded-xl object-cover" /> : <VehicleGlyph className="h-10 w-16 shrink-0" />}
                  <div className="grid min-w-0 flex-1">
                    <p className="truncate font-semibold">{v.nickname || `${v.make} ${v.model}`}</p>
                    <p className="truncate text-sm text-fg-muted">
                      {v.nickname ? `${v.make} ${v.model}` : ''}
                      {v.plate ? `${v.nickname ? ' · ' : ''}${v.plate}` : ''}
                    </p>
                  </div>
                  <ChevronRight className="size-5 text-fg-subtle" aria-hidden />
                </Link>
                {tip && (
                  <div className="flex items-center gap-3 rounded-xl bg-accent-subtle p-3">
                    <Sparkles className="size-4 shrink-0 text-accent-text" aria-hidden />
                    <p className="flex-1 text-sm">{suggestionText(tip)}</p>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => flow.start({ serviceId: tip.service_id, vehicle: { kind: 'saved', id: v.id, body_type: v.body_type, label: v.nickname || `${v.make} ${v.model}` } })}
                    >
                      Записать
                    </Button>
                  </div>
                )}
              </Card>
            </StaggerItem>
          )
        })}
      </Stagger>
    </Section>
  )
}

function PopularServices() {
  const { slug, data, currency, locale, mediaFor } = useTenant()
  return (
    <Section title="Услуги" action={<Link className="text-sm text-accent-text" to={`/s/${slug}/services`}>Все услуги</Link>}>
      <div className="scroll-x -mx-4 flex gap-3 px-4 pb-1">
        {data.services.map((s) => (
          <Link key={s.id} to={`/s/${slug}/services/${s.id}`} className="pressable w-[min(68vw,240px)] shrink-0 snap-start outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-2xl">
            <Card className="overflow-hidden">
              <Img media={mediaFor('service', s.id)[0]} sizes="240px" className="aspect-[4/3] w-full" alt="" />
              <div className="grid gap-1 p-3">
                <p className="line-clamp-2 min-h-[2.5em] font-medium leading-tight">{s.name}</p>
                <p className="flex items-center justify-between text-sm">
                  <span className="text-fg-muted">{s.multi_day ? 'несколько дней' : duration(s.duration_min)}</span>
                  <span className="font-semibold tabular">
                    {hasPriceRange(s) ? 'от ' : ''}
                    {money(minPrice(s), currency, locale)}
                  </span>
                </p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </Section>
  )
}

function Gallery() {
  const { mediaFor } = useTenant()
  return (
    <Section title="Работы студии">
      <div className="scroll-x -mx-4 flex gap-3 px-4 pb-1">
        {mediaFor('gallery').map((m) => (
          <figure key={m.id} className="w-[min(78vw,300px)] shrink-0 snap-start">
            <Img media={m} sizes="300px" className="aspect-[4/3] w-full rounded-2xl" />
            {m.caption && <figcaption className="mt-1.5 px-1 text-sm text-fg-muted">{m.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </Section>
  )
}

function About() {
  const { data } = useTenant()
  const byDay = WEEKDAY_NAMES.map((name, i) => ({ name, windows: data.hours.filter((h) => h.weekday === i + 1) }))
  return (
    <Section title="О студии">
      <Card className="grid gap-4 p-4">
        {data.profile.description && <p className="text-[15px] leading-relaxed text-fg-muted">{data.profile.description}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {byDay.map((d) => (
            <div key={d.name} className="contents">
              <dt className="text-fg-subtle">{d.name}</dt>
              <dd className="tabular">{d.windows.length ? d.windows.map((w) => `${w.opens}–${w.closes}`).join(', ') : 'выходной'}</dd>
            </div>
          ))}
        </dl>
        {data.exceptions.slice(0, 3).map((e) => (
          <p key={e.day} className="text-sm text-warning">
            {new Date(`${e.day}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })}: {e.closed ? 'выходной' : `${e.opens}–${e.closes}`}
            {e.note ? ` — ${e.note}` : ''}
          </p>
        ))}
        <div className="grid gap-2 border-t border-line pt-3 text-sm">
          {data.profile.address && (
            <a href={data.profile.map_url ?? undefined} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-fg-muted">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              {data.profile.address}
            </a>
          )}
          {data.profile.phone && (
            <a href={`tel:${data.profile.phone}`} className="flex items-center gap-2 font-medium text-accent-text">
              <Phone className="size-4" aria-hidden /> {phonePretty(data.profile.phone)}
            </a>
          )}
          {data.profile.socials.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {data.profile.socials.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1.5 text-sm">
                  {s.label ?? s.kind}
                </a>
              ))}
            </div>
          )}
        </div>
      </Card>
    </Section>
  )
}
