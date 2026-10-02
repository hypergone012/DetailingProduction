import { Mail, MapPin, Phone } from 'lucide-react'
import { Link } from 'react-router'
import { phonePretty } from '@/lib/format'
import { useTenant } from '@/tenant/TenantProvider'
import { openStatus, WEEKDAY_NAMES } from '../shared/hours'
import { TABS } from './tabs'

/** Desktop site footer (lg+): the studio, its sections, contacts and hours on every page. */
export function SiteFooter() {
  const { slug, data, mediaByKey, mediaFor } = useTenant()
  const logo = mediaByKey(data.branding.logoKey) ?? mediaFor('logo')[0]
  const p = data.profile
  const status = openStatus(data)
  const ranges = WEEKDAY_NAMES.map((name, i) => ({
    name,
    text: data.hours.filter((h) => h.weekday === i + 1).map((h) => `${h.opens}–${h.closes}`).join(', ') || 'выходной',
  }))
  // "Пн–Пт 09:00–21:00": consecutive days with the same hours collapse into one line.
  const groups: { from: string; to: string; text: string }[] = []
  for (const r of ranges) {
    const last = groups.at(-1)
    if (last && last.text === r.text) last.to = r.name
    else groups.push({ from: r.name, to: r.name, text: r.text })
  }
  return (
    <footer className="mt-20 hidden border-t border-line bg-bg-elevated lg:block">
      <div className="mx-auto grid max-w-[1440px] grid-cols-12 gap-10 px-8 py-14">
        <div className="col-span-4 grid content-start gap-4">
          <Link to={`/s/${slug}`} className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {logo?.url && <img src={logo.url} alt="" className="size-12 rounded-xl border border-line bg-surface object-contain p-1.5" />}
            <span className="text-2xl font-bold tracking-tight">{data.tenant.name}</span>
          </Link>
          {p.tagline && <p className="max-w-sm text-[15px] leading-relaxed text-fg-muted">{p.tagline}</p>}
          <p className="flex items-center gap-2 text-[15px]">
            <span className={status.open ? 'size-2 rounded-full bg-success' : 'size-2 rounded-full bg-fg-subtle'} aria-hidden />
            {status.text}
          </p>
        </div>
        <nav aria-label="Разделы сайта" className="col-span-2 grid content-start gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-fg-subtle">Разделы</p>
          {TABS.map((t) => (
            <Link key={t.key} to={t.segment ? `/s/${slug}/${t.segment}` : `/s/${slug}`} className="w-fit text-[15px] text-fg-muted hover:text-fg">
              {t.key === 'book' ? 'Услуги и запись' : t.label}
            </Link>
          ))}
        </nav>
        <div className="col-span-3 grid content-start gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-fg-subtle">Контакты</p>
          {p.phone && (
            <a href={`tel:${p.phone}`} className="flex items-center gap-2.5 text-lg font-semibold text-accent-text">
              <Phone className="size-5" aria-hidden /> {phonePretty(p.phone)}
            </a>
          )}
          {p.address && (
            <a href={p.map_url ?? undefined} target="_blank" rel="noreferrer" className="flex items-start gap-2.5 text-[15px] text-fg-muted hover:text-fg">
              <MapPin className="mt-0.5 size-5 shrink-0" aria-hidden /> {p.address}
            </a>
          )}
          {p.email && (
            <a href={`mailto:${p.email}`} className="flex items-center gap-2.5 text-[15px] text-fg-muted hover:text-fg">
              <Mail className="size-5" aria-hidden /> {p.email}
            </a>
          )}
          {p.socials.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {p.socials.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3.5 py-1.5 text-sm hover:bg-surface-2">
                  {s.label ?? s.kind}
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="col-span-3 grid content-start gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-fg-subtle">Часы работы</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[15px]">
            {groups.map((g) => (
              <div key={g.from} className="contents">
                <dt className="text-fg-subtle">{g.from === g.to ? g.from : `${g.from}–${g.to}`}</dt>
                <dd className="tabular">{g.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto flex max-w-[1440px] justify-between gap-6 px-8 py-5 text-sm text-fg-subtle">
          <span>
            © {new Date().getFullYear()} {data.tenant.name}
          </span>
          <span>Онлайн-запись работает круглосуточно</span>
        </p>
      </div>
    </footer>
  )
}
