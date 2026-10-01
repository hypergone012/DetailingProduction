import { describe, expect, it } from 'vitest'
import { contrast, isHarsh, toHsl } from './color.ts'
import { THEME_PRESET_IDS, THEME_PRESETS, resolveTheme, themeToCssVars } from './presets.ts'

describe('theme presets', () => {
  it('ships exactly seven families, one per required color', () => {
    expect(THEME_PRESET_IDS).toHaveLength(7)
    expect(new Set(Object.values(THEME_PRESETS).map((p) => p.family))).toEqual(
      new Set(['white', 'black', 'red', 'blue', 'green', 'yellow', 'purple']),
    )
  })

  for (const id of THEME_PRESET_IDS) {
    const t = THEME_PRESETS[id].tokens
    describe(id, () => {
      it('meets WCAG contrast for text, muted text, accents and focus', () => {
        expect(contrast(t.text, t.bg)).toBeGreaterThanOrEqual(12)
        expect(contrast(t.text, t.surface)).toBeGreaterThanOrEqual(11)
        expect(contrast(t.textMuted, t.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.textSubtle, t.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.accentContrast, t.accent)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.accentText, t.surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.focus, t.bg)).toBeGreaterThanOrEqual(3)
        for (const s of [t.success, t.warning, t.danger, t.info]) expect(contrast(s, t.surface)).toBeGreaterThanOrEqual(4.5)
      })

      it('uses no pure or acid colors', () => {
        for (const c of [t.bg, t.surface, t.text, t.accent, t.success, t.warning, t.danger, t.info]) {
          expect(['#ffffff', '#000000', '#ff0000', '#0000ff', '#00ff00', '#ffff00', '#8000ff']).not.toContain(c.toLowerCase())
          expect(isHarsh(c), c).toBe(false)
        }
      })

      it('keeps surfaces distinguishable from the background', () => {
        expect(contrast(t.border, t.surface)).toBeGreaterThan(1.15)
        expect(t.surface).not.toBe(t.bg)
      })
    })
  }

  it('the light preset avoids a pure white canvas', () => {
    const t = THEME_PRESETS.white.tokens
    expect(t.scheme).toBe('light')
    expect(toHsl(t.bg).l).toBeLessThan(0.97)
  })

  it('a brand accent replaces only the accent tokens', () => {
    const base = THEME_PRESETS.black.tokens
    const branded = resolveTheme('black', '#d6a84a')
    expect(branded.accent).toBe('#d6a84a')
    expect(branded.bg).toBe(base.bg)
    expect(branded.text).toBe(base.text)
    expect(contrast(branded.accentContrast, branded.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(branded.accentText, branded.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('a dark accent on a dark theme gets a readable accent-text', () => {
    const t = resolveTheme('black', '#2e3b6b')
    expect(contrast(t.accentText, t.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('renders CSS variables for every token', () => {
    const vars = themeToCssVars(THEME_PRESETS.blue.tokens)
    expect(vars['color-scheme']).toBe('dark')
    expect(vars['--dp-accent']).toBe(THEME_PRESETS.blue.tokens.accent)
    expect(Object.keys(vars)).toHaveLength(28)
  })
})
