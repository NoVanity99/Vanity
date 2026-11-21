// The in-game overlay: who is in your voice room (with a green ring while they talk) and small
// notifications, drawn over a game started from Vanity. Windows only: an Android game takes the
// whole screen and other apps may not draw over it.

export const OVERLAY_CORNERS = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' }
] as const
export type OverlayCorner = (typeof OVERLAY_CORNERS)[number]['id']

export interface OverlaySettings {
  /** The whole overlay. */
  enabled: boolean
  /** Which corner the voice pictures sit in. */
  voiceCorner: OverlayCorner
  /** Notifications over the game. */
  notifications: boolean
  notificationCorner: OverlayCorner
}

export const DEFAULT_OVERLAY: OverlaySettings = { enabled: true, voiceCorner: 'top-left', notifications: true, notificationCorner: 'top-right' }

const corner = (v: unknown, fallback: OverlayCorner): OverlayCorner => (OVERLAY_CORNERS.some((c) => c.id === v) ? (v as OverlayCorner) : fallback)

export function normalizeOverlay(value: unknown): OverlaySettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<OverlaySettings>
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_OVERLAY.enabled,
    voiceCorner: corner(v.voiceCorner, DEFAULT_OVERLAY.voiceCorner),
    notifications: typeof v.notifications === 'boolean' ? v.notifications : DEFAULT_OVERLAY.notifications,
    notificationCorner: corner(v.notificationCorner, DEFAULT_OVERLAY.notificationCorner)
  }
}

/** Someone in your voice room, as the overlay draws them. */
export interface OverlayMember {
  id: string
  name: string
  /** A small data: picture, or null for initials. */
  avatar: string | null
  muted: boolean
  deafened: boolean
}

/** A notification over the game. */
export interface OverlayNote {
  id: number
  /** Who it is about. */
  name: string
  avatar: string | null
  /** What happened, after the name: "sent you a message". */
  action: string
  /** The message text, when there is one. */
  detail: string | null
  kind: 'online' | 'playing' | 'message' | 'voice' | 'request'
}

/** How long a notification stays over the game. */
export const OVERLAY_NOTE_MS = 5000
/** At most this many pictures / notifications at once. */
export const OVERLAY_MAX_MEMBERS = 8
export const OVERLAY_MAX_NOTES = 3

/** Which of the two overlay windows a page is. */
export type OverlayKind = 'voice' | 'notes'

/** What an overlay window is told to draw. */
export interface OverlayState {
  corner: OverlayCorner
  members: OverlayMember[]
  /** Ids of the members talking right now. */
  speaking: string[]
  notes: OverlayNote[]
}

/** The size of each overlay window, so the main program and the page agree. */
export const OVERLAY_LAYOUT = {
  margin: 16,
  voice: { width: 230, row: 52, pad: 12 },
  notes: { width: 380, row: 92, pad: 12 }
} as const

export function voiceWindowSize(members: number): { width: number; height: number } {
  const n = Math.min(OVERLAY_MAX_MEMBERS, Math.max(1, members))
  return { width: OVERLAY_LAYOUT.voice.width, height: n * OVERLAY_LAYOUT.voice.row + OVERLAY_LAYOUT.voice.pad * 2 }
}
export const notesWindowSize = (): { width: number; height: number } => ({ width: OVERLAY_LAYOUT.notes.width, height: OVERLAY_MAX_NOTES * OVERLAY_LAYOUT.notes.row + OVERLAY_LAYOUT.notes.pad * 2 })

/** Where a window of this size goes on a screen (its usable area), for a corner. */
export function cornerPosition(area: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }, where: OverlayCorner, margin: number = OVERLAY_LAYOUT.margin): { x: number; y: number } {
  const left = where.endsWith('left')
  const top = where.startsWith('top')
  return {
    x: Math.round(left ? area.x + margin : area.x + area.width - size.width - margin),
    y: Math.round(top ? area.y + margin : area.y + area.height - size.height - margin)
  }
}

/**
 * Both in the same corner: the notifications go beside the pictures instead of on top of them.
 * Returns how far to shift the notifications sideways.
 */
export const sameCornerShift = (s: OverlaySettings, voiceShown: boolean): number => (voiceShown && s.voiceCorner === s.notificationCorner ? OVERLAY_LAYOUT.voice.width : 0)
