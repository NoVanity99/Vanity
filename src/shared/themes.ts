/** Colour skins. The renderer applies these as CSS variables; the main process uses bg for the window chrome. */
export interface Theme {
  id: string
  name: string
  colors: {
    bg: string
    surface: string
    surface2: string
    border: string
    text: string
    muted: string
    accent: string
    /** Darker partner of the accent, for gradients. */
    accent2: string
  }
}

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    colors: { bg: '#0b0d12', surface: '#12151c', surface2: '#1a1e27', border: '#262b36', text: '#e8ebf1', muted: '#8a91a0', accent: '#ff4747', accent2: '#be123c' }
  },
  {
    id: 'ocean',
    name: 'Ocean',
    colors: { bg: '#07101b', surface: '#0c1725', surface2: '#122138', border: '#1e324e', text: '#e6eef8', muted: '#8ba1b9', accent: '#3b9eff', accent2: '#1d4ed8' }
  },
  {
    id: 'forest',
    name: 'Forest',
    colors: { bg: '#09110d', surface: '#0f1914', surface2: '#15231c', border: '#22362a', text: '#e6f2ea', muted: '#8aa596', accent: '#16a34a', accent2: '#166534' }
  },
  {
    id: 'royal',
    name: 'Royal',
    colors: { bg: '#0d0a15', surface: '#14101f', surface2: '#1c162b', border: '#2c2440', text: '#ece8f6', muted: '#9a90b0', accent: '#a855f7', accent2: '#6d28d9' }
  },
  {
    id: 'sunset',
    name: 'Sunset',
    colors: { bg: '#120c0a', surface: '#1a120f', surface2: '#241915', border: '#382821', text: '#f6ece6', muted: '#b09a8f', accent: '#f97316', accent2: '#c2410c' }
  },
  {
    id: 'oled',
    name: 'OLED Black',
    colors: { bg: '#000000', surface: '#0a0a0b', surface2: '#141416', border: '#232327', text: '#f2f2f3', muted: '#8c8c93', accent: '#ff4747', accent2: '#be123c' }
  }
]

export const DEFAULT_THEME = 'midnight'

export function themeById(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
