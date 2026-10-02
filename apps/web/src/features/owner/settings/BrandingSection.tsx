import { accentIssues } from '@dp/core/theme/accent'
import { DEFAULT_THEME_PRESET, isThemePresetId, resolveTheme, THEME_PRESET_IDS, THEME_PRESETS, type ThemePresetId } from '@dp/core/theme/presets'
import { Camera, Check } from 'lucide-react'
import { useRef, useState } from 'react'
import { Img } from '@/components/Img'
import { Card, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/api/http'
import { cn } from '@/lib/utils'
import { tenantQueryKey, useTenant } from '@/tenant/TenantProvider'
import { rpc } from '../api/client'
import type { SettingsRow } from '../api/types'
import { useOwner, useOwnerMutation } from '../data'
import { PHOTO_SIDES, uploadImage } from '../shared/upload'

/** Studio branding for clients: theme preset, accent, logo, cover photo. */
export function BrandingSection({ settings }: { settings: SettingsRow }) {
  const { tenantId, slug } = useOwner()
  const { mediaByKey, mediaFor, data } = useTenant()
  const [preset, setPreset] = useState<ThemePresetId>(isThemePresetId(settings.branding.themePreset) ? settings.branding.themePreset : DEFAULT_THEME_PRESET)
  const [accent, setAccent] = useState<string | null>(settings.branding.accent ?? null)
  const issues = accent ? accentIssues(preset, accent) : []
  const tokens = resolveTheme(preset, issues.length ? null : accent)
  const dirty = preset !== settings.branding.themePreset || (accent ?? null) !== (settings.branding.accent ?? null)
  const save = useOwnerMutation(
    (patch: Record<string, unknown>) => rpc('owner_update_settings', { p_tenant: tenantId, p_patch: { branding: patch } }),
    [tenantQueryKey(slug)],
  )
  const logo = mediaByKey(data.branding.logoKey) ?? mediaFor('logo')[0]
  const hero = mediaByKey(data.branding.heroKey) ?? mediaFor('hero')[0]

  return (
    <Section title="Брендинг для клиентов">
      <Card className="grid gap-4 p-4">
        <div className="grid gap-2">
          <Label>Тема</Label>
          <div role="radiogroup" aria-label="Тема студии" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {THEME_PRESET_IDS.map((id) => {
              const t = THEME_PRESETS[id].tokens
              const checked = id === preset
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setPreset(id)}
                  className={cn('grid gap-1 rounded-xl p-1.5 text-center text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus', checked ? 'bg-accent-subtle ring-2 ring-accent-text' : '')}
                >
                  <span className="relative grid aspect-square place-items-center rounded-lg border border-line" style={{ background: t.surface }}>
                    <span className="size-4 rounded-full" style={{ background: t.accent }} />
                    {checked && <Check className="absolute top-1 right-1 size-3.5" style={{ color: t.text }} aria-hidden />}
                  </span>
                  {THEME_PRESETS[id].label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="accent-hex">Фирменный цвет (необязательно)</Label>
          <div className="flex items-center gap-2">
            <input type="color" aria-label="Выбрать цвет" value={accent ?? tokens.accent} onChange={(e) => setAccent(e.target.value.toUpperCase())} className="size-11 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent" />
            <Input id="accent-hex" value={accent ?? ''} placeholder="Цвет темы" maxLength={7} onChange={(e) => setAccent(e.target.value ? e.target.value.toUpperCase() : null)} className="max-w-[140px] font-mono" />
            {accent && (
              <Button variant="ghost" size="sm" onClick={() => setAccent(null)}>
                Сбросить
              </Button>
            )}
          </div>
          {issues.map((i) => (
            <p key={i} className="text-sm text-danger">
              {i}
            </p>
          ))}
        </div>
        <div className="grid gap-2 rounded-xl border border-line p-4" style={{ background: tokens.bg, color: tokens.text }} aria-label="Предпросмотр">
          <span className="text-sm" style={{ color: tokens.textMuted }}>
            Так увидят клиенты
          </span>
          <span className="font-semibold">{data.tenant.name}</span>
          <span className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium" style={{ background: tokens.accent, color: tokens.accentContrast }}>
            Записаться
          </span>
        </div>
        {save.error && <p role="alert" className="text-sm text-danger">{errorMessage(save.error)}</p>}
        {dirty && (
          <Button className="justify-self-start" disabled={issues.length > 0} loading={save.isPending} onClick={() => save.mutate({ themePreset: preset, accent })}>
            Сохранить тему
          </Button>
        )}
      </Card>

      <Card className="grid gap-4 p-4">
        <ImageSlot label="Логотип" kind="logo" current={logo} square onUploaded={() => save.mutate({ logoKey: null })} />
        <ImageSlot label="Обложка" kind="hero" current={hero} onUploaded={() => save.mutate({ heroKey: null })} />
        <label className="flex items-start justify-between gap-3 border-t border-line pt-4">
          <span className="grid gap-0.5">
            <span className="text-[15px]">Демонстрационные иллюстрации</span>
            <span className="text-xs text-fg-subtle">Выключите, когда замените обложку, фото услуг и работ реальными снимками студии — это условие рабочего режима.</span>
          </span>
          <Switch checked={Boolean(settings.branding.demoArtwork)} onCheckedChange={(on) => save.mutate({ demoArtwork: on })} />
        </label>
      </Card>
    </Section>
  )
}

function ImageSlot({ label, kind, current, square = false, onUploaded }: { label: string; kind: 'logo' | 'hero'; current: Parameters<typeof Img>[0]['media']; square?: boolean; onUploaded: () => void }) {
  const { tenantId, slug } = useOwner()
  const ref = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const upload = useOwnerMutation(
    async (file: File) => {
      const up = await uploadImage(tenantId, 'public-media', 'branding', file, PHOTO_SIDES[kind])
      // The newest upload wins (lowest sort_order); config images stay as fallback.
      await rpc('owner_register_media', {
        p_tenant: tenantId,
        p_media: { kind, bucket: 'public-media', path: up.path, variants: up.variants, width: up.width, height: up.height, alt: label, sort_order: -Math.floor(Date.now() / 1000) },
      })
    },
    [tenantQueryKey(slug)],
  )
  return (
    <div className="flex items-center gap-3">
      <Img media={current} sizes="160px" className={cn('shrink-0 rounded-xl border border-line', square ? 'size-16 object-contain p-1' : 'h-16 w-28')} alt="" />
      <div className="grid flex-1 gap-1">
        <span className="font-medium">{label}</span>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
      <Button variant="secondary" size="sm" loading={upload.isPending} onClick={() => (setError(null), ref.current?.click())}>
        <Camera /> Заменить
      </Button>
      <input
        ref={ref}
        type="file"
        aria-label={`Заменить: ${label}`}
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload.mutate(f, { onSuccess: onUploaded, onError: (err) => setError(errorMessage(err)) })
          e.target.value = ''
        }}
      />
    </div>
  )
}
