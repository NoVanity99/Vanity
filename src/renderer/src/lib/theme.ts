import { fontById } from '@shared/fonts'
import { themeById } from '@shared/themes'
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

/** Applies a font theme (body and heading faces). */
export function applyFont(id: string | undefined): void {
  const font = fontById(id)
  const root = document.documentElement
  root.style.setProperty('--font-sans', font.body)
  root.style.setProperty('--font-display', font.display)
  document.body.style.fontFamily = font.body
  savePref('font', { id: font.id })
}

export function applySavedFont(): void {
  applyFont(loadPref('font', { id: undefined as string | undefined }).id)
}
