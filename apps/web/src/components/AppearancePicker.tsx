import { DEFAULT_THEME_PRESET, THEME_PRESET_IDS, THEME_PRESETS, isThemePresetId, resolveTheme } from '@dp/core/theme/presets'
import { Check } from 'lucide-react'
import { memo } from 'react'
import { cn } from '@/lib/utils'
import { useAppTheme, type Appearance } from '@/theme/ThemeProvider'
import { useTenant } from '@/tenant/TenantProvider'

interface Option {
  id: Appearance
  label: string
  surface: string
  accent: string
  text: string
}

/**
 * Personal appearance. Changes colors only — the studio's name, photos and services stay as
 * they are. "Как в студии" follows the studio's own branding.
 *
 * Each theme is a round swatch (its background with its accent); the chosen one gets a ring
 * and a check. Plain CSS, no layout animation: choosing a theme does no layout measuring,
 * and the colors switch in one frame (ThemeProvider).
 */
export function AppearancePicker() {
  const { appearance, setAppearance } = useAppTheme()
  const { data } = useTenant()
  const studioPreset = isThemePresetId(data.branding.themePreset) ? data.branding.themePreset : DEFAULT_THEME_PRESET
  const studio = resolveTheme(studioPreset, data.branding.accent ?? null)
  const options: Option[] = [
    { id: 'studio', label: 'Как в студии', surface: studio.surface, accent: studio.accent, text: studio.text },
    ...THEME_PRESET_IDS.map((id) => {
      const t = THEME_PRESETS[id].tokens
      return { id, label: THEME_PRESETS[id].label, surface: t.surface, accent: t.accent, text: t.text }
    }),
  ]
  return (
    <div role="radiogroup" aria-label="Оформление" className="grid grid-cols-4 gap-x-1 gap-y-3 sm:grid-cols-8">
      {options.map((o) => (
        <Swatch key={o.id} option={o} checked={appearance === o.id} onSelect={setAppearance} />
      ))}
    </div>
  )
}

const Swatch = memo(function Swatch({ option: o, checked, onSelect }: { option: Option; checked: boolean; onSelect: (a: Appearance) => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={() => onSelect(o.id)}
      className="group grid min-h-11 justify-items-center gap-1.5 rounded-xl py-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <span
        className={cn(
          'relative grid size-11 place-items-center rounded-full transition-[transform,box-shadow] duration-150 ease-out group-active:scale-90',
          checked ? 'shadow-[0_0_0_2px_var(--dp-bg),0_0_0_4px_var(--dp-accent-text)]' : 'shadow-[0_0_0_1px_var(--dp-border)]',
        )}
        // Background half, accent half: the whole theme at a glance.
        style={{ background: `linear-gradient(135deg, ${o.surface} 0 50%, ${o.accent} 50% 100%)` }}
        aria-hidden
      >
        <Check className={cn('size-4 transition-[opacity,transform] duration-150 ease-out', checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0')} style={{ color: '#fff', filter: 'drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.7))' }} strokeWidth={3} />
      </span>
      <span className={cn('text-[11px] leading-tight', checked ? 'font-medium text-fg' : 'text-fg-muted')}>{o.label}</span>
    </button>
  )
})
