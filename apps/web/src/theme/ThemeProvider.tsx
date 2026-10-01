import { Theme } from '@astryxdesign/core/theme'
import { DEFAULT_THEME_PRESET, isThemePresetId, resolveTheme, themeToCssVars, type ThemePresetId, type ThemeTokens } from '@dp/core/theme/presets'
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { storage } from '@/lib/storage'
import { detailingTheme } from './astryx/detailing.js'

/**
 * Two separate concerns:
 *   - tenant BRANDING (studio preset + brand accent), set by the studio;
 *   - user APPEARANCE (this person's choice of preset and motion), stored on this device.
 * 'studio' appearance means "use the studio's branding". Choosing another preset changes
 * only colors: studio name, photos, services and configuration are untouched.
 */
export type Appearance = 'studio' | ThemePresetId
export type MotionPreference = 'system' | 'reduce'

interface ThemeContextValue {
  appearance: Appearance
  setAppearance: (a: Appearance) => void
  motion: MotionPreference
  setMotion: (m: MotionPreference) => void
  tokens: ThemeTokens
  scheme: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export interface Branding {
  themePreset?: string | null
  accent?: string | null
}

function applyTokens(tokens: ThemeTokens) {
  const root = document.documentElement
  for (const [k, val] of Object.entries(themeToCssVars(tokens))) {
    if (k === 'color-scheme') root.style.colorScheme = val
    else root.style.setProperty(k, val)
  }
  root.dataset.scheme = tokens.scheme
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = tokens.bg
}

export function ThemeProvider({ storageKey, branding, children }: { storageKey: string; branding: Branding | null; children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(() => {
    const saved = storage.get(`${storageKey}:appearance`)
    return saved && (saved === 'studio' || isThemePresetId(saved)) ? saved : 'studio'
  })
  const [motion, setMotionState] = useState<MotionPreference>(() => (storage.get(`${storageKey}:motion`) === 'reduce' ? 'reduce' : 'system'))

  const tokens = useMemo(() => {
    if (appearance !== 'studio') return resolveTheme(appearance)
    const preset = isThemePresetId(branding?.themePreset) ? branding!.themePreset : DEFAULT_THEME_PRESET
    return resolveTheme(preset as ThemePresetId, branding?.accent ?? null)
  }, [appearance, branding])

  useLayoutEffect(() => applyTokens(tokens), [tokens])
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = motion === 'reduce' ? 'reduce' : ''
  }, [motion])

  const setAppearance = useCallback(
    (a: Appearance) => {
      setAppearanceState(a)
      storage.set(`${storageKey}:appearance`, a)
    },
    [storageKey],
  )
  const setMotion = useCallback(
    (m: MotionPreference) => {
      setMotionState(m)
      storage.set(`${storageKey}:motion`, m)
    },
    [storageKey],
  )

  const value = useMemo(() => ({ appearance, setAppearance, motion, setMotion, tokens, scheme: tokens.scheme }), [appearance, setAppearance, motion, setMotion, tokens])
  return (
    <ThemeContext.Provider value={value}>
      <Theme theme={detailingTheme} mode={tokens.scheme}>
        {children}
      </Theme>
    </ThemeContext.Provider>
  )
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useAppTheme outside ThemeProvider')
  return ctx
}
