import { alpha, contrast, ensureContrast, isHex, mix } from './color.ts'

/**
 * Appearance presets. Seven families (white, black, red, blue, green, yellow, purple),
 * interpreted as deep, muted, business colors. One preset is active at a time: it defines
 * surfaces, text and ONE primary accent; status colors are semantic support only.
 *
 * Components never use these hex values directly: they read CSS custom properties
 * produced by `themeToCssVars` (see apps/web/src/theme).
 */

export type ThemeScheme = 'light' | 'dark'

export interface ThemeTokens {
  scheme: ThemeScheme
  bg: string
  bgElevated: string
  surface: string
  surface2: string
  sunken: string
  scrim: string
  text: string
  textMuted: string
  textSubtle: string
  textInverse: string
  border: string
  borderStrong: string
  accent: string
  accentHover: string
  accentContrast: string
  accentText: string
  accentSubtle: string
  focus: string
  success: string
  successSubtle: string
  warning: string
  warningSubtle: string
  danger: string
  dangerSubtle: string
  info: string
  infoSubtle: string
  shadow: string
}

// Seven muted presets named by their base color; labels for people live with the tokens.
export const THEME_PRESET_IDS = ['white', 'black', 'red', 'blue', 'green', 'yellow', 'purple'] as const
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number]
export const DEFAULT_THEME_PRESET: ThemePresetId = 'black'

export interface ThemePreset {
  id: ThemePresetId
  label: string
  family: 'white' | 'black' | 'red' | 'blue' | 'green' | 'yellow' | 'purple'
  /** Swatch for the picker. */
  swatch: [string, string]
  tokens: ThemeTokens
}

interface Base {
  scheme: ThemeScheme
  bg: string
  bgElevated: string
  surface: string
  surface2: string
  sunken: string
  text: string
  textMuted: string
  textSubtle: string
  border: string
  borderStrong: string
  accent: string
}

const STATUS_DARK = { success: '#5DB088', warning: '#D9AB52', danger: '#E07B72', info: '#7EA3E0' }
const STATUS_LIGHT = { success: '#2B6E4E', warning: '#86600F', danger: '#A23A33', info: '#2D5592' }

/** Fills in the derived tokens of a base palette. Also used for tenant accent overrides. */
export function buildTokens(base: Base, accentOverride?: string | null): ThemeTokens {
  const dark = base.scheme === 'dark'
  const accent = accentOverride && isHex(accentOverride) ? accentOverride.toLowerCase() : base.accent
  const onLight = '#14130F'
  const onDark = '#FAF8F4'
  const accentContrast = contrast(onDark, accent) >= contrast(onLight, accent) ? onDark : onLight
  const accentText = ensureContrast(accent, base.surface, 4.5, base.text)
  const status = dark ? STATUS_DARK : STATUS_LIGHT
  return {
    ...base,
    accent,
    scrim: dark ? 'rgba(4, 5, 7, 0.62)' : 'rgba(28, 26, 22, 0.38)',
    textInverse: dark ? '#14130F' : '#F6F4EF',
    accentHover: mix(accent, dark ? '#FFFFFF' : '#000000', 0.1),
    accentContrast,
    accentText,
    accentSubtle: alpha(accent, dark ? 0.16 : 0.1),
    focus: accentText,
    success: status.success,
    successSubtle: alpha(status.success, dark ? 0.16 : 0.1),
    warning: status.warning,
    warningSubtle: alpha(status.warning, dark ? 0.16 : 0.12),
    danger: status.danger,
    dangerSubtle: alpha(status.danger, dark ? 0.16 : 0.1),
    info: status.info,
    infoSubtle: alpha(status.info, dark ? 0.16 : 0.1),
    shadow: dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(40, 34, 24, 0.12)',
  }
}

const bases: Record<ThemePresetId, { label: string; family: ThemePreset['family']; base: Base }> = {
  white: {
    label: 'Светлая',
    family: 'white',
    base: {
      scheme: 'light',
      bg: '#F2F0EB',
      bgElevated: '#F8F6F2',
      surface: '#FBFAF7',
      surface2: '#F4F1EB',
      sunken: '#EAE6DF',
      text: '#1D1C19',
      textMuted: '#57534B',
      textSubtle: '#6F6A61',
      border: '#DCD6CC',
      borderStrong: '#BDB5A8',
      accent: '#2A2D33',
    },
  },
  black: {
    label: 'Графит',
    family: 'black',
    base: {
      scheme: 'dark',
      bg: '#0E0F11',
      bgElevated: '#131416',
      surface: '#17181B',
      surface2: '#1E2023',
      sunken: '#0A0B0C',
      text: '#ECEAE6',
      textMuted: '#A9A6A0',
      textSubtle: '#8A8780',
      border: '#2A2C30',
      borderStrong: '#3B3D42',
      accent: '#C5C9D0',
    },
  },
  red: {
    label: 'Бордо',
    family: 'red',
    base: {
      scheme: 'dark',
      bg: '#130B0D',
      bgElevated: '#180E11',
      surface: '#1D1215',
      surface2: '#26181C',
      sunken: '#0E0809',
      text: '#F1E8E9',
      textMuted: '#BCA7AB',
      textSubtle: '#9D878B',
      border: '#3A2429',
      borderStrong: '#4E3238',
      accent: '#A63E52',
    },
  },
  blue: {
    label: 'Кобальт',
    family: 'blue',
    base: {
      scheme: 'dark',
      bg: '#0A0F1D',
      bgElevated: '#0D1324',
      surface: '#111830',
      surface2: '#18213D',
      sunken: '#070B16',
      text: '#E8ECF5',
      textMuted: '#A3ADC4',
      textSubtle: '#8590AA',
      border: '#26304D',
      borderStrong: '#344164',
      accent: '#3A63C2',
    },
  },
  green: {
    label: 'Лес',
    family: 'green',
    base: {
      scheme: 'dark',
      bg: '#09110D',
      bgElevated: '#0C1611',
      surface: '#101B15',
      surface2: '#16241C',
      sunken: '#060C09',
      text: '#E7EEE9',
      textMuted: '#A0B4A8',
      textSubtle: '#83978B',
      border: '#22352A',
      borderStrong: '#2F4738',
      accent: '#2E7650',
    },
  },
  yellow: {
    label: 'Янтарь',
    family: 'yellow',
    base: {
      scheme: 'dark',
      bg: '#110E09',
      bgElevated: '#16120B',
      surface: '#1B160E',
      surface2: '#241D12',
      sunken: '#0B0906',
      text: '#F2ECDF',
      textMuted: '#BDB198',
      textSubtle: '#9E937C',
      border: '#3A3020',
      borderStrong: '#4C3F2A',
      accent: '#CE9B3E',
    },
  },
  purple: {
    label: 'Слива',
    family: 'purple',
    base: {
      scheme: 'dark',
      bg: '#100B15',
      bgElevated: '#140E1A',
      surface: '#1A1221',
      surface2: '#23192C',
      sunken: '#0B070E',
      text: '#EEE8F3',
      textMuted: '#B4A6C1',
      textSubtle: '#9688A3',
      border: '#34273F',
      borderStrong: '#463553',
      accent: '#8457B2',
    },
  },
}

export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = Object.fromEntries(
  THEME_PRESET_IDS.map((id) => {
    const b = bases[id]
    return [id, { id, label: b.label, family: b.family, swatch: [b.base.surface, b.base.accent], tokens: buildTokens(b.base) }]
  }),
) as Record<ThemePresetId, ThemePreset>

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === 'string' && (THEME_PRESET_IDS as readonly string[]).includes(value)
}

/** Tokens for a preset, optionally with a tenant brand accent replacing the preset accent. */
export function resolveTheme(presetId: ThemePresetId, accentOverride?: string | null): ThemeTokens {
  const preset = THEME_PRESETS[presetId]
  if (!accentOverride) return preset.tokens
  return buildTokens(bases[presetId].base, accentOverride)
}

const VAR_NAMES: Record<Exclude<keyof ThemeTokens, 'scheme'>, string> = {
  bg: '--dp-bg',
  bgElevated: '--dp-bg-elevated',
  surface: '--dp-surface',
  surface2: '--dp-surface-2',
  sunken: '--dp-sunken',
  scrim: '--dp-scrim',
  text: '--dp-text',
  textMuted: '--dp-text-muted',
  textSubtle: '--dp-text-subtle',
  textInverse: '--dp-text-inverse',
  border: '--dp-border',
  borderStrong: '--dp-border-strong',
  accent: '--dp-accent',
  accentHover: '--dp-accent-hover',
  accentContrast: '--dp-accent-contrast',
  accentText: '--dp-accent-text',
  accentSubtle: '--dp-accent-subtle',
  focus: '--dp-focus',
  success: '--dp-success',
  successSubtle: '--dp-success-subtle',
  warning: '--dp-warning',
  warningSubtle: '--dp-warning-subtle',
  danger: '--dp-danger',
  dangerSubtle: '--dp-danger-subtle',
  info: '--dp-info',
  infoSubtle: '--dp-info-subtle',
  shadow: '--dp-shadow',
}

/** CSS custom properties for a token set. */
export function themeToCssVars(tokens: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = { 'color-scheme': tokens.scheme }
  for (const [key, name] of Object.entries(VAR_NAMES)) out[name] = tokens[key as keyof typeof VAR_NAMES]
  return out
}
