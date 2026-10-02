import { contrast, isHarsh, isHex } from './color.ts'
import { resolveTheme, THEME_PRESETS, type ThemePresetId } from './presets.ts'

/**
 * Why a studio accent color is not acceptable for a theme (empty: fine). The same rules
 * apply to business.json (Zod) and to the owner cabinet.
 */
export function accentIssues(preset: ThemePresetId, accent: string): string[] {
  if (!isHex(accent)) return ['цвет в формате #RRGGBB']
  const issues: string[] = []
  if (isHarsh(accent)) issues.push('слишком кислотный цвет: выберите глубокий или приглушённый оттенок')
  const t = resolveTheme(preset, accent)
  if (contrast(t.accentContrast, t.accent) < 4.5) issues.push('недостаточный контраст текста на акцентном цвете')
  if (contrast(accent, THEME_PRESETS[preset].tokens.bg) < 1.6) issues.push('акцент почти не отличается от фона темы')
  return issues
}
