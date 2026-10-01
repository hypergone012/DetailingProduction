import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral'

/**
 * SOURCE of the Astryx theme. The app imports the BUILT output (detailing.js/.css):
 *   pnpm --filter @dp/web theme:build      (regenerate)
 *   pnpm --filter @dp/web theme:check      (CI: fail if the build is stale)
 *
 * One Astryx theme for the whole app. It inherits the neutral theme (icons, component
 * defaults) and points every color token at the app's semantic --dp-* variables, so
 * switching the appearance preset or a tenant accent re-colors Astryx components without
 * re-creating the theme.
 */
const v = (name: string) => `var(--dp-${name})`

export const detailingTheme = defineTheme({
  name: 'detailing',
  extends: neutralTheme,
  typography: {
    scale: { base: 15, ratio: 1.2 },
    body: { family: 'Onest Variable', fallbacks: 'ui-sans-serif, system-ui, -apple-system, sans-serif' },
    heading: { family: 'Onest Variable', fallbacks: 'ui-sans-serif, system-ui, sans-serif' },
  },
  radius: { base: 4, multiplier: 1.25 },
  motion: { fast: 160, medium: 320, ratio: 0.75 },
  tokens: {
    '--color-accent': v('accent'),
    '--color-accent-muted': v('accent-subtle'),
    '--color-on-accent': v('accent-contrast'),
    '--color-text-accent': v('accent-text'),
    '--color-icon-accent': v('accent-text'),
    '--color-background-body': v('bg'),
    '--color-background-surface': v('surface'),
    '--color-background-card': v('surface'),
    '--color-background-popover': v('surface-2'),
    '--color-background-muted': v('sunken'),
    '--color-overlay': v('scrim'),
    '--color-text-primary': v('text'),
    '--color-text-secondary': v('text-muted'),
    '--color-text-disabled': v('text-subtle'),
    '--color-icon-primary': v('text'),
    '--color-icon-secondary': v('text-muted'),
    '--color-icon-disabled': v('text-subtle'),
    '--color-border': v('border'),
    '--color-border-emphasized': v('border-strong'),
    '--color-skeleton': v('surface-2'),
    '--color-track': v('border-strong'),
    '--color-success': v('success'),
    '--color-success-muted': v('success-subtle'),
    '--color-error': v('danger'),
    '--color-error-muted': v('danger-subtle'),
    '--color-warning': v('warning'),
    '--color-warning-muted': v('warning-subtle'),
    '--color-shadow': v('shadow'),
    '--focus-outline-color': v('focus'),
    '--size-element-sm': '36px',
    '--size-element-md': '44px',
    '--size-element-lg': '48px',
  },
})
