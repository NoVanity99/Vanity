import { fontById } from '@shared/fonts'
import { themeById } from '@shared/themes'
import { sanitizeUi, type UiPrefs } from '@shared/ui'
import { loadPref, savePref } from './storage'

const VARS = {
  bg: '--color-bg',
  surface: '--color-surface',
  surface2: '--color-surface-2',
  border: '--color-border',
  text: '--color-text',
  muted: '--color-muted',
  accent: '--color-accent',
  accent2: '--color-accent-2'
} as const

/** Applies a skin by overriding the Tailwind colour variables on <html>. */
export function applyTheme(id: string | undefined): void {
  const theme = themeById(id)
  const root = document.documentElement
  for (const [key, cssVar] of Object.entries(VARS)) root.style.setProperty(cssVar, theme.colors[key as keyof typeof VARS])
  root.dataset.theme = theme.id
  // Remember locally too, so the next start paints the right colours before settings load.
  savePref('theme', { id: theme.id })
}

/** Applies the last used skin immediately at startup. */
export function applySavedTheme(): void {
  applyTheme(loadPref('theme', { id: undefined as string | undefined }).id)
}

/**
 * Applies a font theme to all text in the app: titles, menus, buttons, labels and numbers
 * use the theme's main face. Themes that pair two fonts keep the second one only for long
 * passages (descriptions, notes), where a display face would be hard to read.
 */
export function applyFont(id: string | undefined): void {
  const font = fontById(id)
  const root = document.documentElement
  root.style.setProperty('--font-sans', font.display)
  root.style.setProperty('--font-display', font.display)
  root.style.setProperty('--font-reading', font.body)
  root.dataset.font = font.id
  document.body.style.fontFamily = font.display
  savePref('font', { id: font.id })
}

export function applySavedFont(): void {
  applyFont(loadPref('font', { id: undefined as string | undefined }).id)
}

/** A darker partner for a custom accent colour, for gradients. */
function darker(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const part = (shift: number): string => Math.round(((n >> shift) & 255) * 0.62).toString(16).padStart(2, '0')
  return `#${part(16)}${part(8)}${part(0)}`
}

const CORNER_SCALE = { sharp: 0.25, soft: 1, round: 1.7 } as const
/** Tailwind's corner sizes, in rem: scaled together so every card, button and panel follows. */
const RADII: Record<string, number> = { xs: 0.125, sm: 0.25, md: 0.375, lg: 0.5, xl: 0.75, '2xl': 1, '3xl': 1.5 }

/** Applies the launcher options from Settings → Customize. Call after applyTheme. */
export function applyUi(ui: UiPrefs | undefined, themeId: string | undefined): void {
  const u = sanitizeUi(ui)
  const root = document.documentElement
  const theme = themeById(themeId)
  root.style.setProperty(VARS.accent, u.accent || theme.colors.accent)
  root.style.setProperty(VARS.accent2, u.accent ? darker(u.accent) : theme.colors.accent2)
  for (const [name, rem] of Object.entries(RADII)) root.style.setProperty(`--radius-${name}`, `${rem * CORNER_SCALE[u.corners]}rem`)
  root.style.fontSize = `${(16 * u.scale) / 100}px`
  root.dataset.cardHover = u.cardHover
  root.dataset.glass = u.glass ? 'on' : 'off'
  root.classList.toggle('reduce-motion', u.reduceMotion)
}
