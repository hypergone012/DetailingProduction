import { THEME_PRESET_IDS, THEME_PRESETS, isThemePresetId, resolveTheme } from '@dp/core/theme/presets'
import { Check } from 'lucide-react'
import { m } from 'motion/react'
import { cn } from '@/lib/utils'
import { spring } from '@/motion/tokens'
import { useAppTheme, type Appearance } from '@/theme/ThemeProvider'
import { useTenant } from '@/tenant/TenantProvider'

/**
 * Personal appearance. Changes colors only — the studio's name, photos and services stay as
 * they are. "Как в студии" follows the studio's own branding.
 */
export function AppearancePicker() {
  const { appearance, setAppearance } = useAppTheme()
  const { data } = useTenant()
  const studioPreset = isThemePresetId(data.branding.themePreset) ? data.branding.themePreset : 'graphite'
  const studio = resolveTheme(studioPreset, data.branding.accent ?? null)
  const options: { id: Appearance; label: string; surface: string; accent: string; text: string }[] = [
    { id: 'studio', label: 'Как в студии', surface: studio.surface, accent: studio.accent, text: studio.text },
    ...THEME_PRESET_IDS.map((id) => {
      const t = THEME_PRESETS[id].tokens
      return { id, label: THEME_PRESETS[id].label, surface: t.surface, accent: t.accent, text: t.text }
    }),
  ]
  return (
    <div role="radiogroup" aria-label="Оформление" className="grid grid-cols-4 gap-2">
      {options.map((o) => {
        const checked = appearance === o.id
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => setAppearance(o.id)}
            className={cn('pressable relative grid gap-1.5 rounded-xl p-1.5 pb-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-focus', checked ? 'bg-accent-subtle' : 'bg-transparent')}
          >
            {checked && <m.span layoutId="appearance-ring" className="absolute inset-0 rounded-xl border-2 border-accent-text" transition={spring} aria-hidden />}
            <span className="relative grid aspect-square place-items-center overflow-hidden rounded-lg border border-line" style={{ background: o.surface }}>
              <span className="absolute bottom-1.5 left-1.5 h-1.5 w-6 rounded-full" style={{ background: o.text, opacity: 0.6 }} />
              <span className="size-5 rounded-full" style={{ background: o.accent }} />
              {checked && <Check className="absolute top-1 right-1 size-3.5" style={{ color: o.text }} aria-hidden />}
            </span>
            <span className="relative text-[11px] leading-tight text-fg-muted">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
