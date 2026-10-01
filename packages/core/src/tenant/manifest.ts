import { isThemePresetId, resolveTheme } from '../theme/presets.ts'

/**
 * Web App Manifest for one tenant: the shared frontend build serves every studio, and each
 * studio installs as its own app with its own id/scope/start_url/icons. The owner cabinet
 * is a separate installable app nested under the studio scope.
 */
export interface ManifestIcon {
  w: number
  url: string
  purpose?: string
}

export interface ManifestInput {
  slug: string
  name: string
  tagline: string
  locale: string
  themePreset?: string | null
  accent?: string | null
  icons: ManifestIcon[]
}

export function tenantThemeColors(input: Pick<ManifestInput, 'themePreset' | 'accent'>) {
  const preset = isThemePresetId(input.themePreset) ? input.themePreset : 'graphite'
  const t = resolveTheme(preset, input.accent ?? null)
  return { background: t.bg, theme: t.bg, scheme: t.scheme }
}

export function buildManifest(input: ManifestInput, appUrl: string, app: 'client' | 'owner') {
  const base = app === 'client' ? `/s/${input.slug}/` : `/s/${input.slug}/owner/`
  const origin = appUrl.replace(/\/$/, '')
  const colors = tenantThemeColors(input)
  const icons = input.icons
    .filter((i) => i.purpose === 'any' || i.purpose === 'maskable')
    .map((i) => ({ src: i.url, sizes: `${i.w}x${i.w}`, type: 'image/png', purpose: i.purpose }))
  const name = app === 'client' ? input.name : `${input.name} — кабинет`
  return {
    id: `${origin}${base}`,
    name,
    short_name: (app === 'client' ? input.name : `${input.name} · CRM`).slice(0, 24),
    description: app === 'client' ? input.tagline : `Рабочий кабинет студии ${input.name}`,
    lang: input.locale,
    dir: 'ltr',
    start_url: `${origin}${base}`,
    scope: `${origin}${base}`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: colors.background,
    theme_color: colors.theme,
    categories: app === 'client' ? ['lifestyle', 'shopping'] : ['business', 'productivity'],
    icons,
  }
}

export type WebManifest = ReturnType<typeof buildManifest>
