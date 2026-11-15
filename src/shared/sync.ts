// What the app and the Vanity server exchange to keep your progress the same on every device.
//
// The rules, in short:
// - Counters (playtime, launches) are kept per device and added up, so two devices that were
//   both played on while offline never overwrite each other.
// - Sets (days played, badges) are merged: nothing earned is ever lost.
// - Choices (favourite, status, rating, notes, collections, settings) carry the time they were
//   last changed. The server's copy wins unless the device's change is newer.

/** One game's counters on one device. */
export interface SyncGame {
  /** Vanity's game key (the normalised title), so the same game matches on every device and store. */
  key: string
  name: string
  playtimeSeconds: number
  launches: number
  lastPlayedAt: number | null
  firstPlayedAt: number | null
}

/** Your own choices for a game. */
export interface SyncPrefs {
  key: string
  favorite: boolean
  playStatus: string | null
  /** 1–5, or null. */
  userRating: number | null
  notes: string | null
  /** When any of these last changed (ms). */
  updatedAt: number
}

export interface SyncCollections {
  updatedAt: number
  items: { name: string; games: string[] }[]
}

/** The settings that make sense on every device (look and feel), not paths or folders. */
export const SYNCED_SETTINGS = ['theme', 'font', 'ambientBackground', 'controllerEnabled', 'breakReminderMinutes', 'discordPresence', 'minimizeWhilePlaying'] as const
export type SyncedSettingKey = (typeof SYNCED_SETTINGS)[number]

export interface SyncSettings {
  updatedAt: number
  values: Partial<Record<SyncedSettingKey, string | number | boolean>>
}

export interface SyncRequest {
  /** A random id made once per installation. */
  deviceId: string
  deviceName: string
  games: SyncGame[]
  prefs: SyncPrefs[]
  /** Days with any play (YYYY-MM-DD). */
  days: string[]
  /** Badge id → when it was unlocked (ms). */
  badges: Record<string, number>
  /** Null: this device has never changed them, so it only wants to receive. */
  collections: SyncCollections | null
  settings: SyncSettings | null
  /** Shown to friends. Worked out by the app from the merged data. */
  summary: { xp: number; level: number }
}

/** A game's counters across all your devices. */
export interface CloudGame extends SyncGame {
  /** The part that comes from your other devices (not the one asking). */
  otherPlaytimeSeconds: number
  otherLaunches: number
}

export interface SyncResponse {
  serverTime: number
  games: CloudGame[]
  prefs: SyncPrefs[]
  days: string[]
  badges: Record<string, number>
  collections: SyncCollections | null
  settings: SyncSettings | null
}

export const SYNC_LIMITS = { games: 5000, days: 6000, collections: 200, collectionGames: 5000, notes: 5000, badges: 200 } as const
