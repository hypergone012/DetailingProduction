import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Bot, CalendarClock, CalendarPlus, ChevronRight, Clock, MapPin, Navigation, Phone, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { Img } from '@/components/Img'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { dayParts, duration, money, phonePretty, today, when } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Stagger, StaggerItem } from '@/motion/Stagger'
import { useTenant } from '@/tenant/TenantProvider'
import { useChatParam } from '@/components/assistant/chatParam'
import { useBookingFlow } from '../booking/flow'
import { hasPriceRange, isUpcoming, keys, minPrice, useProfile } from '../data'
import { suggestionText } from '../garage/suggestions'
import { Card, Section } from '@/components/Section'
import { StatusBadge } from '@/components/StatusBadge'
import { VehicleGlyph } from '@/components/VehicleGlyph'
import { SiteSection } from '../layout/site'
import { WEEKDAY_NAMES, openStatus } from '../shared/hours'

/** Buttons over the cover photo (desktop): light on any theme, the photo is darkened under them. */
const ON_PHOTO =
  'pressable inline-flex h-14 items-center gap-2.5 rounded-xl border border-white/25 bg-white/10 px-6 text-[17px] font-medium text-white backdrop-blur-md outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-focus [&_svg]:size-5'

/** Services shown on the desktop home page (the rest are one click away). */
const HOME_SERVICES = 8

export function HomeScreen() {
  const { data } = useTenant()
  return (
    <div className="mx-auto grid max-w-xl gap-6 pb-8 md:max-w-2xl lg:max-w-[1440px] lg:gap-20 lg:px-8 lg:pt-8 lg:pb-0">
      <StudioHero />
      {/* Phone: one column in priority order. Desktop: booking beside "mine", then full-width bands. */}
      <div className="grid gap-6 px-4 lg:-mt-12 lg:grid-cols-12 lg:px-0">
        <BookNowCard className="lg:col-span-7" />
        <div className="grid gap-6 lg:col-span-5 lg:flex lg:flex-col">
          {data.features.ai !== false && <AssistantCard />}
          <UpcomingBooking />
          <GarageGlance />
          <StudioToday />
        </div>
      </div>
      <div className="grid min-w-0 gap-6 px-4 lg:gap-20 lg:px-0">
        <PopularServices />
        <HowItWorks />
        {data.media.some((m) => m.kind === 'gallery') && <Gallery />}
        <About />
      </div>
    </div>
  )
}

function StudioHero() {
  const { slug, data, currency, locale, mediaByKey, mediaFor } = useTenant()
  const flow = useBookingFlow()
  const hero = mediaByKey(data.branding.heroKey) ?? mediaFor('hero')[0]
  const logo = mediaByKey(data.branding.logoKey) ?? mediaFor('logo')[0]
  const status = openStatus(data)
  const cheapest = data.services.length ? Math.min(...data.services.map(minPrice)) : null
  const facts = [
    { value: String(data.services.length), label: servicesWord(data.services.length) },
    ...(cheapest !== null ? [{ value: `от ${money(cheapest, currency, locale)}`, label: 'стоимость' }] : []),
    { value: `${data.policy.horizon_days} дн.`, label: 'запись вперёд' },
  ]
  return (
    <header className="relative lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-line">
      <div className="relative aspect-[16/9] max-h-[320px] w-full overflow-hidden bg-sunken lg:aspect-auto lg:h-[clamp(480px,68vh,680px)] lg:max-h-none">
        <Img media={hero} priority sizes="(min-width: 1024px) min(1376px, 100vw), 100vw" className="size-full" alt={data.branding.heroAlt ?? ''} />
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-bg to-transparent lg:hidden" aria-hidden />
        <div
          className="absolute inset-0 hidden bg-[linear-gradient(to_top,rgb(0_0_0/0.88),rgb(0_0_0/0.35)_48%,rgb(0_0_0/0.08)),linear-gradient(to_right,rgb(0_0_0/0.55),transparent_62%)] lg:block"
          aria-hidden
        />
      </div>
      <div className="relative -mt-8 grid gap-2 px-4 lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-10 lg:p-12 lg:text-white">
        <div className="grid gap-2 lg:gap-5">
          <div className="flex items-center gap-3 lg:gap-5">
            {logo?.url && (
              <img
                src={logo.url}
                alt=""
                className="size-14 shrink-0 rounded-2xl border border-line bg-surface object-contain p-2 shadow-sm lg:size-20 lg:rounded-3xl lg:border-white/20 lg:bg-black/45 lg:p-3 lg:backdrop-blur-md"
              />
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 lg:gap-x-4">
              <h1 className="text-[26px] leading-tight font-semibold text-balance lg:text-[64px] lg:leading-[1.02] lg:font-bold lg:tracking-tight">{data.tenant.name}</h1>
              {data.tenant.status === 'demo' && (
                <Badge tone="warning" className="lg:px-3 lg:py-1 lg:text-sm">
                  Демо
                </Badge>
              )}
            </div>
          </div>
          {data.profile.tagline && <p className="text-[15px] text-fg-muted lg:max-w-3xl lg:text-[22px] lg:leading-snug lg:text-white/85">{data.profile.tagline}</p>}
          <p className="flex min-w-0 items-center gap-1.5 text-sm lg:gap-2.5 lg:text-[17px]">
            <span className={cn('size-2 shrink-0 rounded-full lg:size-2.5', status.open ? 'bg-success' : 'bg-fg-subtle lg:bg-white/60')} aria-hidden />
            <span className={cn('shrink-0 lg:text-white', status.open ? 'text-fg' : 'text-fg-muted')}>{status.text}</span>
            {data.profile.address && (
              <>
                <span className="truncate text-fg-subtle lg:hidden">· {data.profile.address.split(',')[0]}</span>
                <span className="hidden truncate text-white/70 lg:inline">· {data.profile.address}</span>
              </>
            )}
          </p>
          <div className="hidden flex-wrap items-center gap-3 pt-2 lg:flex">
            <Button size="lg" className="h-14 px-7 text-[17px]" onClick={() => flow.start()}>
              <CalendarPlus /> Записаться онлайн
            </Button>
            {data.profile.phone && (
              <a href={`tel:${data.profile.phone}`} className={ON_PHOTO}>
                <Phone /> {phonePretty(data.profile.phone)}
              </a>
            )}
            <Link to={`/s/${slug}/services`} className={ON_PHOTO}>
              Услуги и цены <ArrowRight />
            </Link>
          </div>
        </div>
        <dl className="hidden gap-3 lg:grid">
          {facts.map((f) => (
            <div key={f.label} className="grid min-w-44 gap-0.5 rounded-2xl border border-white/15 bg-black/40 px-5 py-4 backdrop-blur-md">
              <dt className="order-2 text-sm text-white/70">{f.label}</dt>
              <dd className="order-1 text-2xl font-bold tabular">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  )
}

function servicesWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'услуга'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'услуги'
  return 'услуг'
}

function AssistantCard() {
  const chat = useChatParam()
  return (
    <button
      type="button"
      onClick={chat.show}
      className="pressable flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-card outline-none focus-visible:ring-2 focus-visible:ring-focus lg:gap-4 lg:rounded-3xl lg:p-5"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent-text lg:size-12">
        <Bot className="size-5 lg:size-6" aria-hidden />
      </span>
      <span className="grid flex-1 gap-0.5">
        <span className="font-semibold lg:text-lg">Спросить помощника</span>
        <span className="text-sm text-fg-muted lg:text-[15px]">Цены, свободное время и запись — в чате</span>
      </span>
      <ChevronRight className="size-4 text-fg-subtle lg:size-5" aria-hidden />
    </button>
  )
}

/** Booking first: one tap to start, with the real nearest free time from the server. */
function BookNowCard({ className }: { className?: string }) {
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
    <Card className={cn('grid gap-4 p-4 lg:flex lg:flex-col lg:gap-6 lg:rounded-3xl lg:p-8', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1 lg:gap-2">
          <h2 className="text-lg font-semibold lg:text-[30px] lg:leading-tight lg:font-bold lg:tracking-tight">Записаться онлайн</h2>
          <p className="text-sm text-fg-muted lg:text-[17px]">Точная цена и свободное время — сразу, без звонка.</p>
        </div>
        <CalendarClock className="size-6 shrink-0 text-accent-text lg:size-9" aria-hidden />
      </div>
      {featured && (
        <div className="flex items-center gap-2 rounded-xl bg-sunken px-3 py-2.5 text-sm lg:gap-3 lg:rounded-2xl lg:px-5 lg:py-4 lg:text-[17px]">
          <Clock className="size-4 shrink-0 text-fg-muted lg:size-5" aria-hidden />
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
      <Button
        size="lg"
        block
        className="lg:h-14 lg:text-[17px]"
        onClick={() => flow.start(vehicle ? { vehicle: { kind: 'saved', id: vehicle.id, body_type: vehicle.body_type, label: vehicle.nickname || `${vehicle.make} ${vehicle.model}` } } : {})}
      >
        Выбрать услугу и время <ArrowRight />
      </Button>
      <div className="grid gap-3 lg:mt-auto">
        <p className="hidden text-sm font-medium text-fg-subtle lg:block">Или сразу на услугу:</p>
        <div className="scroll-x -mx-4 flex gap-2 px-4 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
          {data.services.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => flow.start({ serviceId: s.id, ...(vehicle ? { vehicle: { kind: 'saved' as const, id: vehicle.id, body_type: vehicle.body_type, label: vehicle.nickname || `${vehicle.make} ${vehicle.model}` } } : {}) })}
              className={cn(
                'pressable shrink-0 snap-start rounded-full border border-line bg-bg-elevated px-3.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus lg:px-4 lg:py-2.5 lg:text-[15px] lg:transition-colors lg:hover:border-accent-text/50',
                i >= 5 && 'hidden lg:inline-block',
                i >= HOME_SERVICES && 'lg:hidden',
              )}
            >
              {s.name} <span className="text-fg-subtle tabular">· {hasPriceRange(s) ? 'от ' : ''}{money(minPrice(s), currency, locale)}</span>
            </button>
          ))}
        </div>
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
      <Link to={`/s/${slug}/history/${next.id}`} className="pressable block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-focus lg:rounded-3xl">
        <Card className="flex items-center gap-4 border-accent-text/40 p-4 lg:rounded-3xl lg:p-5">
          <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg lg:size-16 lg:rounded-2xl">
            <span className="text-[11px] uppercase leading-none lg:text-xs">{new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'short' }).format(new Date(next.starts_at)).replace('.', '')}</span>
            <span className="text-xl leading-none font-semibold tabular lg:text-2xl">{new Intl.DateTimeFormat(locale, { timeZone: tz, day: 'numeric' }).format(new Date(next.starts_at))}</span>
          </div>
          <div className="grid min-w-0 flex-1 gap-0.5 lg:gap-1">
            <p className="truncate font-semibold lg:text-lg">{next.service_name}</p>
            <p className="text-sm text-fg-muted first-letter:uppercase lg:text-[15px]">
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
        <Link to={`/s/${slug}/garage`} className="pressable block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-focus lg:rounded-3xl">
          <Card className="flex items-center gap-4 p-4 lg:rounded-3xl lg:p-5">
            <VehicleGlyph className="h-10 w-20 shrink-0" />
            <div className="grid flex-1 gap-0.5 text-sm lg:text-[15px]">
              <p className="font-medium lg:text-lg lg:font-semibold">Добавьте автомобиль</p>
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
              <Card className="grid gap-3 p-4 lg:rounded-3xl lg:p-5">
                <Link to={`/s/${slug}/garage/${v.id}`} className="flex items-center gap-3 outline-none lg:gap-4">
                  {v.photo?.url ? <img src={v.photo.url} alt="" className="size-12 rounded-xl object-cover lg:size-14" /> : <VehicleGlyph className="h-10 w-16 shrink-0 lg:w-20" />}
                  <div className="grid min-w-0 flex-1">
                    <p className="truncate font-semibold lg:text-lg">{v.nickname || `${v.make} ${v.model}`}</p>
                    <p className="truncate text-sm text-fg-muted lg:text-[15px]">
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

/** Desktop: closes the booking row with today's status, address and phone (fills the column). */
function StudioToday() {
  const { data } = useTenant()
  const status = openStatus(data)
  const p = data.profile
  return (
    <Card className="hidden lg:flex lg:flex-1 lg:flex-col lg:gap-4 lg:rounded-3xl lg:p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.08em] text-fg-subtle">Студия сегодня</p>
      <p className="flex items-center gap-2.5 text-xl font-semibold">
        <span className={cn('size-2.5 rounded-full', status.open ? 'bg-success' : 'bg-fg-subtle')} aria-hidden />
        {status.text}
      </p>
      {p.address && (
        <a href={p.map_url ?? undefined} target="_blank" rel="noreferrer" className="flex items-start gap-2.5 text-[15px] text-fg-muted hover:text-fg">
          <MapPin className="mt-0.5 size-5 shrink-0" aria-hidden />
          {p.address}
        </a>
      )}
      {p.phone && (
        <a href={`tel:${p.phone}`} className="mt-auto flex items-center gap-2.5 text-lg font-semibold text-accent-text">
          <Phone className="size-5" aria-hidden /> {phonePretty(p.phone)}
        </a>
      )}
    </Card>
  )
}

function PopularServices() {
  const { slug, data, currency, locale, mediaFor } = useTenant()
  const chat = useChatParam()
  const shown = Math.min(data.services.length, HOME_SERVICES)
  // Desktop grid of 4: an unfinished last row is closed by a help tile instead of a hole.
  const rest = shown % 4 === 0 ? 0 : 4 - (shown % 4)
  return (
    <SiteSection
      size="xl"
      title="Услуги"
      subtitle={`${data.services.length} ${servicesWord(data.services.length)} · цена сразу для вашего кузова`}
      action={
        <Link className="flex items-center gap-1.5 text-sm text-accent-text lg:text-[17px] lg:font-medium" to={`/s/${slug}/services`}>
          Все услуги <ArrowRight className="hidden size-5 lg:block" aria-hidden />
        </Link>
      }
    >
      <div className="scroll-x -mx-4 flex gap-3 px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0">
        {data.services.map((s, i) => (
          <Link
            key={s.id}
            to={`/s/${slug}/services/${s.id}`}
            className={cn(
              'pressable group w-[min(68vw,240px)] shrink-0 snap-start rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-focus lg:w-auto lg:rounded-3xl',
              i >= HOME_SERVICES && 'lg:hidden',
            )}
          >
            <Card className="overflow-hidden lg:flex lg:h-full lg:flex-col lg:rounded-3xl lg:transition-colors lg:group-hover:border-line-strong">
              <div className="overflow-hidden">
                <Img media={mediaFor('service', s.id)[0]} sizes="(min-width: 1024px) 300px, 240px" className="aspect-[4/3] w-full lg:transition-transform lg:duration-500 lg:group-hover:scale-[1.04]" alt="" />
              </div>
              <div className="grid gap-1 p-3 lg:flex lg:flex-1 lg:flex-col lg:gap-2 lg:p-5">
                <p className="line-clamp-2 min-h-[2.5em] font-medium leading-tight lg:min-h-0 lg:text-lg lg:font-semibold">{s.name}</p>
                {s.summary && <p className="hidden text-[15px] text-fg-muted lg:line-clamp-2">{s.summary}</p>}
                <p className="flex items-center justify-between text-sm lg:mt-auto lg:flex-wrap lg:gap-x-3 lg:gap-y-1 lg:border-t lg:border-line lg:pt-3 lg:text-[15px]">
                  <span className="flex items-center gap-1.5 text-fg-muted">
                    <Clock className="hidden size-4 lg:block" aria-hidden />
                    {s.multi_day ? 'несколько дней' : duration(s.duration_min)}
                  </span>
                  <span className="font-semibold tabular lg:text-lg lg:font-bold">
                    {hasPriceRange(s) ? 'от ' : ''}
                    {money(minPrice(s), currency, locale)}
                  </span>
                </p>
              </div>
            </Card>
          </Link>
        ))}
        {rest > 0 && (
          <div
            className="hidden flex-col justify-center gap-4 rounded-3xl border border-dashed border-line-strong bg-surface/40 p-7 lg:flex"
            style={{ gridColumn: `span ${rest} / span ${rest}` }}
          >
            <p className="text-xl font-semibold">Не нашли нужную услугу?</p>
            <p className="text-[15px] leading-relaxed text-fg-muted">Расскажите, что нужно сделать с автомобилем, — подберём уход и рассчитаем стоимость.</p>
            <div className="flex flex-wrap gap-2">
              {data.profile.phone && (
                <Button asChild variant="secondary">
                  <a href={`tel:${data.profile.phone}`}>
                    <Phone /> Позвонить
                  </a>
                </Button>
              )}
              {data.features.ai !== false && (
                <Button variant="secondary" onClick={chat.show}>
                  <Bot /> Спросить в чате
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </SiteSection>
  )
}

/** Desktop: the three booking steps, with the studio's real rules (confirmation, cancel window). */
function HowItWorks() {
  const { data } = useTenant()
  const steps = [
    { title: 'Выберите услугу', text: 'Стоимость сразу рассчитывается для вашего типа кузова — без звонков и уточнений.' },
    {
      title: 'Выберите время',
      text: data.policy.requires_confirmation
        ? 'Показываем только свободное время. Студия подтвердит запись, статус виден в «Мои записи».'
        : 'Показываем только свободное время — запись подтверждается сразу.',
    },
    {
      title: 'Приезжайте',
      text: `Запись хранится в «Мои записи»: перенести или отменить её можно онлайн не позднее чем за ${data.policy.cancel_cutoff_hours} ч до визита.`,
    },
  ]
  return (
    <SiteSection size="xl" title="Как проходит запись" subtitle="Онлайн, без звонков и регистрации" className="hidden lg:grid">
      <ol className="grid grid-cols-3 gap-6">
        {steps.map((s, i) => (
          <li key={s.title} className="grid content-start gap-3 rounded-3xl border border-line bg-surface p-8 shadow-card">
            <span className="text-5xl font-bold tracking-tight text-accent-text tabular">{String(i + 1).padStart(2, '0')}</span>
            <p className="text-xl font-semibold">{s.title}</p>
            <p className="text-[16px] leading-relaxed text-fg-muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </SiteSection>
  )
}

function Gallery() {
  const { mediaFor } = useTenant()
  const photos = mediaFor('gallery')
  // Desktop rows: 2 photos side by side, 4 as 2×2, more in rows of 3–4; a short last row stretches.
  const n = photos.length
  const cols = n <= 3 ? n : n === 4 ? 2 : Math.min(4, Math.ceil(n / 2))
  return (
    <SiteSection size="xl" title="Работы студии">
      <div
        className="scroll-x -mx-4 flex gap-3 px-4 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-focus lg:mx-0 lg:flex-wrap lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0"
        role="region"
        aria-label="Работы студии"
        tabIndex={0}
      >
        {photos.map((m) => (
          <figure
            key={m.id}
            className="w-[min(78vw,300px)] shrink-0 snap-start lg:relative lg:w-auto lg:[flex:1_1_var(--gallery-basis)] lg:overflow-hidden lg:rounded-3xl"
            style={{ '--gallery-basis': `calc(${100 / cols}% - 24px)` } as React.CSSProperties}
          >
            <Img media={m} sizes="(min-width: 1024px) 640px, 300px" className="aspect-[4/3] w-full rounded-2xl lg:aspect-auto lg:h-[340px] lg:rounded-none" />
            {m.caption && (
              <figcaption className="mt-1.5 px-1 text-sm text-fg-muted lg:absolute lg:inset-x-0 lg:bottom-0 lg:m-0 lg:bg-gradient-to-t lg:from-black/80 lg:to-transparent lg:px-6 lg:pt-14 lg:pb-5 lg:text-[17px] lg:font-medium lg:text-white">
                {m.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    </SiteSection>
  )
}

function About() {
  const { data } = useTenant()
  const byDay = WEEKDAY_NAMES.map((name, i) => ({ name, windows: data.hours.filter((h) => h.weekday === i + 1) }))
  const todayWd = dayParts(today(data.tenant.timezone)).isoWeekday
  const exceptions = data.exceptions.slice(0, 3).map((e) => ({
    day: e.day,
    text: `${new Date(`${e.day}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })}: ${e.closed ? 'выходной' : `${e.opens}–${e.closes}`}${e.note ? ` — ${e.note}` : ''}`,
  }))
  const p = data.profile
  return (
    <SiteSection size="xl" title="О студии">
      {/* Phone */}
      <Card className="grid gap-4 p-4 lg:hidden">
        {p.description && <p className="text-[15px] leading-relaxed text-fg-muted">{p.description}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          {byDay.map((d) => (
            <div key={d.name} className="contents">
              <dt className="text-fg-subtle">{d.name}</dt>
              <dd className="tabular">{d.windows.length ? d.windows.map((w) => `${w.opens}–${w.closes}`).join(', ') : 'выходной'}</dd>
            </div>
          ))}
        </dl>
        {exceptions.map((e) => (
          <p key={e.day} className="text-sm text-warning">
            {e.text}
          </p>
        ))}
        <div className="grid gap-2 border-t border-line pt-3 text-sm">
          {p.address && (
            <a href={p.map_url ?? undefined} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-fg-muted">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              {p.address}
            </a>
          )}
          {p.phone && (
            <a href={`tel:${p.phone}`} className="flex items-center gap-2 font-medium text-accent-text">
              <Phone className="size-4" aria-hidden /> {phonePretty(p.phone)}
            </a>
          )}
          {p.socials.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {p.socials.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1.5 text-sm">
                  {s.label ?? s.kind}
                </a>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Desktop: story, hours, how to get there */}
      <div className="hidden grid-cols-12 gap-6 lg:grid">
        <Card className="col-span-5 grid content-start gap-5 rounded-3xl p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-fg-subtle">Студия</p>
          <p className="text-[19px] leading-relaxed text-fg">{p.description || p.tagline}</p>
          {p.socials.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {p.socials.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="rounded-full border border-line px-4 py-2 text-[15px] hover:bg-surface-2">
                  {s.label ?? s.kind}
                </a>
              ))}
            </div>
          )}
        </Card>
        <Card className="col-span-3 grid content-start gap-4 rounded-3xl p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-fg-subtle">Часы работы</p>
          <dl className="grid gap-1 text-[16px]">
            {byDay.map((d, i) => (
              <div key={d.name} className={cn('flex justify-between gap-4 rounded-lg px-3 py-1.5', i + 1 === todayWd && 'bg-accent-subtle font-semibold text-accent-text')}>
                <dt className={cn(i + 1 !== todayWd && 'text-fg-subtle')}>{d.name}</dt>
                <dd className="tabular">{d.windows.length ? d.windows.map((w) => `${w.opens}–${w.closes}`).join(', ') : 'выходной'}</dd>
              </div>
            ))}
          </dl>
          {exceptions.map((e) => (
            <p key={e.day} className="text-sm leading-snug text-warning">
              {e.text}
            </p>
          ))}
        </Card>
        <Card className="col-span-4 grid content-start gap-5 rounded-3xl p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-fg-subtle">Как нас найти</p>
          {p.address && <p className="text-[19px] leading-snug">{p.address}</p>}
          {p.phone && (
            <a href={`tel:${p.phone}`} className="text-[28px] leading-none font-bold tracking-tight text-accent-text tabular">
              {phonePretty(p.phone)}
            </a>
          )}
          {p.email && (
            <a href={`mailto:${p.email}`} className="text-[15px] text-fg-muted hover:text-fg">
              {p.email}
            </a>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {p.map_url && (
              <Button asChild variant="secondary">
                <a href={p.map_url} target="_blank" rel="noreferrer">
                  <Navigation /> Маршрут
                </a>
              </Button>
            )}
            {p.phone && (
              <Button asChild>
                <a href={`tel:${p.phone}`}>
                  <Phone /> Позвонить
                </a>
              </Button>
            )}
          </div>
        </Card>
      </div>
    </SiteSection>
  )
}
