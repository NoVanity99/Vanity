// The pieces of the launcher you can switch on, off or restyle in Settings → Customize.
// Kept on this device (a phone and a PC usually want different layouts).

/** Sidebar entries that can be hidden. Library, Settings and Account always stay. */
export const NAV_ITEMS = [
  { id: 'trending', label: 'Trending' },
  { id: 'store', label: 'Steam Store' },
  { id: 'friends', label: 'Friends' },
  { id: 'voice', label: 'Voice' },
  { id: 'recent', label: 'Recently Played' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'stats', label: 'Stats' },
  { id: 'profile', label: 'Profile' },
  { id: 'downloads', label: 'Downloads' }
] as const
export type NavItemId = (typeof NAV_ITEMS)[number]['id']

export const START_PAGES = [
  { id: 'library', label: 'Library', path: '/library' },
  { id: 'recent', label: 'Recently Played', path: '/recent' },
  { id: 'favorites', label: 'Favorites', path: '/favorites' },
  { id: 'trending', label: 'Trending', path: '/trending' },
  { id: 'friends', label: 'Friends', path: '/friends' },
  { id: 'stats', label: 'Stats', path: '/stats' },
  { id: 'profile', label: 'Profile', path: '/profile' }
] as const
export type StartPageId = (typeof START_PAGES)[number]['id']

export const UI_SCALES = [
  { id: 'compact', label: 'Compact' },
  { id: 'normal', label: 'Normal' },
  { id: 'large', label: 'Large' }
] as const
export const CORNER_STYLES = [
  { id: 'round', label: 'Round' },
  { id: 'soft', label: 'Soft' },
  { id: 'square', label: 'Square' }
] as const
export const COVER_HOVERS = [
  { id: 'zoom', label: 'Zoom and shine' },
  { id: 'lift', label: 'Lift only' },
  { id: 'none', label: 'Nothing' }
] as const
export const CLOCK_STYLES = [
  { id: 'off', label: 'Off' },
  { id: '12', label: '12-hour' },
  { id: '24', label: '24-hour' }
] as const

/** The narrowest and widest the sidebar can be dragged to, and where it starts. */
export const SIDEBAR_WIDTH = { min: 220, max: 420, normal: 240 } as const
export function clampSidebarWidth(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : SIDEBAR_WIDTH.normal
  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, n))
}

export interface InterfaceOptions {
  /** The page Vanity opens on. */
  startPage: StartPageId
  /** Sidebar entries that are hidden. */
  hiddenNav: NavItemId[]
  sidebarCollections: boolean
  sidebarLevel: boolean
  sidebarSearch: boolean
  sidebarCounts: boolean
  /** How wide the sidebar is, in pixels (drag its edge), and whether it is tucked away. Computers only. */
  sidebarWidth: number
  sidebarCollapsed: boolean
  /**
   * Top bar: the dots showing whether Steam, Epic and the others are up. Off unless turned on.
   * (Stored under a new name in 0.24.0, so it starts off for everyone, including people who had it on.)
   */
  launcherStatusBar: boolean
  musicPlayer: boolean
  clock: (typeof CLOCK_STYLES)[number]['id']
  /** Library. */
  jumpBackIn: boolean
  playerCounts: boolean
  statusBadges: boolean
  gameNames: boolean
  vibeCheckButton: boolean
  surpriseButton: boolean
  coverHover: (typeof COVER_HOVERS)[number]['id']
  /** Look and feel. */
  scale: (typeof UI_SCALES)[number]['id']
  corners: (typeof CORNER_STYLES)[number]['id']
  animations: boolean
  toasts: boolean
  /** Friends: a notification when one comes online, starts a game or messages you. */
  notifyFriendOnline: boolean
  notifyFriendPlaying: boolean
  notifyFriendMessage: boolean
}

export const DEFAULT_INTERFACE: InterfaceOptions = {
  startPage: 'library',
  hiddenNav: [],
  sidebarCollections: true,
  sidebarLevel: true,
  sidebarSearch: true,
  sidebarCounts: true,
  sidebarWidth: SIDEBAR_WIDTH.normal,
  sidebarCollapsed: false,
  launcherStatusBar: false,
  musicPlayer: true,
  clock: 'off',
  jumpBackIn: true,
  playerCounts: true,
  statusBadges: true,
  gameNames: true,
  vibeCheckButton: true,
  surpriseButton: true,
  coverHover: 'zoom',
  scale: 'normal',
  corners: 'round',
  animations: true,
  toasts: true,
  notifyFriendOnline: true,
  notifyFriendPlaying: true,
  notifyFriendMessage: true
}

const oneOf = <T extends string>(value: unknown, list: readonly { id: T }[], fallback: T): T => (list.some((x) => x.id === value) ? (value as T) : fallback)

/** Whatever was stored, as a complete set of options with only known values. */
export function normalizeInterface(stored: unknown): InterfaceOptions {
  const v = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const d = DEFAULT_INTERFACE
  const flag = (key: keyof InterfaceOptions): boolean => (typeof v[key] === 'boolean' ? (v[key] as boolean) : (d[key] as boolean))
  return {
    startPage: oneOf(v.startPage, START_PAGES, d.startPage),
    hiddenNav: Array.isArray(v.hiddenNav) ? NAV_ITEMS.map((n) => n.id).filter((id) => (v.hiddenNav as unknown[]).includes(id)) : [],
    sidebarCollections: flag('sidebarCollections'),
    sidebarLevel: flag('sidebarLevel'),
    sidebarSearch: flag('sidebarSearch'),
    sidebarCounts: flag('sidebarCounts'),
    sidebarWidth: clampSidebarWidth(v.sidebarWidth),
    sidebarCollapsed: flag('sidebarCollapsed'),
    launcherStatusBar: flag('launcherStatusBar'),
    musicPlayer: flag('musicPlayer'),
    clock: oneOf(v.clock, CLOCK_STYLES, d.clock),
    jumpBackIn: flag('jumpBackIn'),
    playerCounts: flag('playerCounts'),
    statusBadges: flag('statusBadges'),
    gameNames: flag('gameNames'),
    vibeCheckButton: flag('vibeCheckButton'),
    surpriseButton: flag('surpriseButton'),
    coverHover: oneOf(v.coverHover, COVER_HOVERS, d.coverHover),
    scale: oneOf(v.scale, UI_SCALES, d.scale),
    corners: oneOf(v.corners, CORNER_STYLES, d.corners),
    animations: flag('animations'),
    toasts: flag('toasts'),
    notifyFriendOnline: flag('notifyFriendOnline'),
    notifyFriendPlaying: flag('notifyFriendPlaying'),
    notifyFriendMessage: flag('notifyFriendMessage')
  }
}
