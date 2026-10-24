/** Font themes. `body` is used for all text, `display` for big headings. */
export interface FontTheme {
  id: string
  name: string
  /** CSS font-family lists. Fonts other than Segoe UI are bundled with the app. */
  body: string
  display: string
}

const SEGOE = "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"

export const FONT_THEMES: FontTheme[] = [
  { id: 'system', name: 'Segoe (Windows)', body: SEGOE, display: SEGOE },
  { id: 'inter', name: 'Inter', body: `'Inter Variable', ${SEGOE}`, display: `'Inter Variable', ${SEGOE}` },
  { id: 'outfit', name: 'Outfit', body: `'Outfit Variable', ${SEGOE}`, display: `'Outfit Variable', ${SEGOE}` },
  { id: 'grotesk', name: 'Space Grotesk', body: `'Space Grotesk Variable', ${SEGOE}`, display: `'Space Grotesk Variable', ${SEGOE}` },
  { id: 'sora', name: 'Sora', body: `'Sora Variable', ${SEGOE}`, display: `'Sora Variable', ${SEGOE}` },
  { id: 'arcade', name: 'Arcade (Exo 2 + Orbitron)', body: `'Exo 2 Variable', ${SEGOE}`, display: `'Orbitron Variable', ${SEGOE}` },
  { id: 'esports', name: 'Esports (Rajdhani)', body: `'Rajdhani', ${SEGOE}`, display: `'Rajdhani', ${SEGOE}` },
  { id: 'terminal', name: 'Terminal (JetBrains Mono)', body: `'JetBrains Mono Variable', ui-monospace, monospace`, display: `'JetBrains Mono Variable', ui-monospace, monospace` }
]

export const DEFAULT_FONT = 'system'

export function fontById(id: string | undefined): FontTheme {
  return FONT_THEMES.find((f) => f.id === id) ?? FONT_THEMES[0]
}
