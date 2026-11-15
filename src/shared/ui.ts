/** How the launcher itself is laid out and behaves: the modular options in Settings → Customize. */
export interface UiPrefs {
  /** Your own accent colour (#rrggbb) over any skin; empty uses the skin's. */
  accent: string
  /** Corner style for cards, buttons and panels. */
  corners: 'sharp' | 'soft' | 'round'
  /** Size of everything, as a percentage (85–125). */
  scale: number
  /** What moves behind the interface. */
  background: 'glow' | 'aurora' | 'grid' | 'stars' | 'none'
  /** What a game cover does when you point at it. */
  cardHover: 'lift' | 'zoom' | 'glow' | 'tilt' | 'none'
  /** Turn most animations off. */
  reduceMotion: boolean
  /** The page Vanity opens on. */
  startPage: 'library' | 'trending' | 'recent' | 'favorites' | 'stats' | 'friends'
  /** Sidebar entries you've switched off (by path, e.g. "/store"). */
  hiddenNav: string[]
  /** Order of the sidebar entries (by path); ones not listed keep their usual place after these. */
  navOrder: string[]
  /** Icons only, for more room. */
  compactSidebar: boolean
  showLevel: boolean
  showSearch: boolean
  showMusicPlayer: boolean
  showLauncherStatus: boolean
  showCollections: boolean
  /** See-through panels that blur what's behind them. */
  glass: boolean
}

export const NAV_MODULES: { path: string; label: string }[] = [
  { path: '/library', label: 'Library' },
  { path: '/trending', label: 'Trending' },
  { path: '/store', label: 'Steam Store' },
  { path: '/friends', label: 'Friends' },
  { path: '/recent', label: 'Recently Played' },
  { path: '/favorites', label: 'Favorites' },
  { path: '/stats', label: 'Stats' },
  { path: '/profile', label: 'Profile' },
  { path: '/downloads', label: 'Downloads' }
]

export const DEFAULT_UI: UiPrefs = {
  accent: '',
  corners: 'soft',
  scale: 100,
  background: 'glow',
  cardHover: 'lift',
  reduceMotion: false,
  startPage: 'library',
  hiddenNav: [],
  navOrder: [],
  compactSidebar: false,
  showLevel: true,
  showSearch: true,
  showMusicPlayer: true,
  showLauncherStatus: true,
  showCollections: true,
  glass: true
}

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T => (options.includes(value as T) ? (value as T) : fallback)
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const paths = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && NAV_MODULES.some((m) => m.path === v)))] : []

/** Turns stored settings into valid options, filling in anything missing. */
export function sanitizeUi(raw: unknown): UiPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const hidden = paths(r.hiddenNav).filter((p) => p !== '/library') // the Library can't be hidden
  return {
    accent: typeof r.accent === 'string' && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent.toLowerCase() : '',
    corners: oneOf(['sharp', 'soft', 'round'] as const, r.corners, DEFAULT_UI.corners),
    scale: typeof r.scale === 'number' && Number.isFinite(r.scale) ? Math.min(125, Math.max(85, Math.round(r.scale / 5) * 5)) : 100,
    background: oneOf(['glow', 'aurora', 'grid', 'stars', 'none'] as const, r.background, DEFAULT_UI.background),
    cardHover: oneOf(['lift', 'zoom', 'glow', 'tilt', 'none'] as const, r.cardHover, DEFAULT_UI.cardHover),
    reduceMotion: bool(r.reduceMotion, false),
    startPage: oneOf(['library', 'trending', 'recent', 'favorites', 'stats', 'friends'] as const, r.startPage, 'library'),
    hiddenNav: hidden,
    navOrder: paths(r.navOrder),
    compactSidebar: bool(r.compactSidebar, false),
    showLevel: bool(r.showLevel, true),
    showSearch: bool(r.showSearch, true),
    showMusicPlayer: bool(r.showMusicPlayer, true),
    showLauncherStatus: bool(r.showLauncherStatus, true),
    showCollections: bool(r.showCollections, true),
    glass: bool(r.glass, true)
  }
}

/** The sidebar entries to show, in the user's order. */
export function orderedNav(ui: UiPrefs): { path: string; label: string }[] {
  const rank = (path: string): number => {
    const i = ui.navOrder.indexOf(path)
    return i === -1 ? ui.navOrder.length + NAV_MODULES.findIndex((m) => m.path === path) : i
  }
  return NAV_MODULES.filter((m) => !ui.hiddenNav.includes(m.path)).sort((a, b) => rank(a.path) - rank(b.path))
}
