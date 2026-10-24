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
  },
  {
    id: 'neon',
    name: 'Neon City',
    colors: { bg: '#0a0614', surface: '#120a22', surface2: '#1a1030', border: '#2e1d4d', text: '#f3eaff', muted: '#a08cc0', accent: '#ff2bd6', accent2: '#00b8d4' }
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    colors: { bg: '#120820', surface: '#1a0d2e', surface2: '#24123d', border: '#3a1f5c', text: '#fbeaff', muted: '#b394c9', accent: '#ff6ac1', accent2: '#7b2ff7' }
  },
  {
    id: 'arctic',
    name: 'Arctic',
    colors: { bg: '#0a1117', surface: '#0f1a22', surface2: '#15232e', border: '#223645', text: '#e8f6fb', muted: '#8fb0bf', accent: '#0ea5c9', accent2: '#0e7490' }
  },
  {
    id: 'crimson',
    name: 'Crimson',
    colors: { bg: '#0f0507', surface: '#18090c', surface2: '#220d12', border: '#3a161e', text: '#fbe9ec', muted: '#b88f97', accent: '#e11d48', accent2: '#881337' }
  },
  {
    id: 'gold',
    name: 'Gilded',
    colors: { bg: '#0e0c08', surface: '#17140d', surface2: '#211c12', border: '#3a311f', text: '#f8f1e2', muted: '#b4a582', accent: '#c99a1e', accent2: '#8a6512' }
  },
  {
    id: 'sakura',
    name: 'Sakura',
    colors: { bg: '#130a0f', surface: '#1c1016', surface2: '#26161e', border: '#3e2431', text: '#fdeef5', muted: '#c099ab', accent: '#ec4899', accent2: '#9d174d' }
  },
  {
    id: 'matrix',
    name: 'Matrix',
    colors: { bg: '#020a05', surface: '#06120a', surface2: '#0a1a0f', border: '#14301c', text: '#dcffe6', muted: '#7fae8c', accent: '#16a34a', accent2: '#14532d' }
  },
  {
    id: 'mocha',
    name: 'Mocha',
    colors: { bg: '#14100d', surface: '#1d1713', surface2: '#272019', border: '#3d3127', text: '#f5ebe1', muted: '#b39e8a', accent: '#c47c4a', accent2: '#7c4a2d' }
  },
  {
    id: 'slate',
    name: 'Slate',
    colors: { bg: '#0f1115', surface: '#161920', surface2: '#1e222b', border: '#2d323d', text: '#eef1f6', muted: '#97a0b0', accent: '#6366f1', accent2: '#4338ca' }
  }
]

export const DEFAULT_THEME = 'midnight'

export function themeById(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
