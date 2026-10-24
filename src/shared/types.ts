// Types shared between the main process, preload and renderer.

export type GameSource = 'steam' | 'epic' | 'gog' | 'ea' | 'ubisoft' | 'custom' | 'manual'

/** Sources that have a scanner and can be toggled in settings. */
export type ScanSource = Exclude<GameSource, 'manual'>

export const SCAN_SOURCES: ScanSource[] = ['steam', 'epic', 'gog', 'ea', 'ubisoft', 'custom']

export const SOURCE_LABELS: Record<GameSource, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG Galaxy',
  ea: 'EA app',
  ubisoft: 'Ubisoft Connect',
  custom: 'Custom folders',
  manual: 'Added manually'
}

export interface Game {
  id: number
  source: GameSource
  /** Stable identifier within its source (Steam app ID, Epic app name, GOG game ID, exe path…). */
  externalId: string
  name: string
  installPath: string | null
  executablePath: string | null
  favorite: boolean
  hidden: boolean
  /** The last scan of this game's source no longer found it (uninstalled or moved). */
  missing: boolean
  addedAt: number
  lastPlayedAt: number | null
  playtimeSeconds: number
  // Metadata (filled in by the metadata stage)
  description: string | null
  genres: string[]
  releaseDate: string | null
  developer: string | null
  coverPath: string | null
  heroPath: string | null
  logoPath: string | null
  iconPath: string | null
  metadata: GameMetadataInfo
}

export type MetadataStatus =
  /** Not fetched yet. */
  | 'pending'
  /** Found on SteamGridDB, IGDB or Steam. */
  | 'matched'
  /** Searched, but no confident match: the user can pick one. */
  | 'unmatched'
  /** No API keys, and no keyless source for this game. */
  | 'no-keys'
  /** The last attempt failed (offline, API error); retried later. */
  | 'error'

export interface GameMetadataInfo {
  status: MetadataStatus
  error: string | null
  updatedAt: number | null
  steamGridDbId: number | null
  igdbId: number | null
  /** The user picked the match; automatic matching leaves it alone. */
  matchLocked: boolean
  /** The user edited description/genres/date/developer; refreshes don't overwrite them. */
  detailsLocked: boolean
  /** Artwork kinds the user chose by hand. */
  lockedArtwork: ArtworkKind[]
}

export type ArtworkKind = 'cover' | 'hero' | 'logo' | 'icon'

export const ARTWORK_LABELS: Record<ArtworkKind, string> = {
  cover: 'Cover',
  hero: 'Banner',
  logo: 'Logo',
  icon: 'Icon'
}

/** A possible game to match against, shown in the "Fix match" search. */
export interface MatchCandidate {
  provider: 'igdb' | 'steamgriddb'
  id: number
  name: string
  year: number | null
  /** Small cover image (remote URL) for the picker. */
  thumbUrl: string | null
  /** Steam app ID, if the provider knows it (helps find the same game on the other provider). */
  steamAppId: string | null
}

export interface ArtworkOption {
  id: number
  url: string
  thumbUrl: string
  width: number
  height: number
}

export interface MetadataProgress {
  running: boolean
  done: number
  total: number
}

export type KeyCheck = 'ok' | 'missing' | 'invalid' | { error: string }

/** A game discovered by a scanner, before it is stored. */
export interface DetectedGame {
  source: GameSource
  externalId: string
  name: string
  installPath: string | null
  executablePath: string | null
}

/** A possible game found in a custom folder; the user confirms before it is added. */
export interface GameCandidate extends DetectedGame {
  /** Other executables in the same folder, in case the guess is wrong. */
  alternatives: string[]
}

export interface ScanProgress {
  source: ScanSource
  status: 'pending' | 'scanning' | 'done' | 'skipped' | 'error'
  found: number
  message?: string
}

export interface ScanSummary {
  progress: ScanProgress[]
  added: number
  updated: number
  /** Games that were in the library but were not found this time. */
  missing: number
  /** Custom-folder finds waiting for the user to confirm. */
  candidates: GameCandidate[]
}

export interface Settings {
  steamGridDbApiKey: string
  igdbClientId: string
  igdbClientSecret: string
  customFolders: string[]
  enabledSources: Record<ScanSource, boolean>
  /** Executables the user declined when reviewing custom-folder finds. */
  ignoredExecutables: string[]
}

/** Fields the user can change on a game. */
export interface GamePatch {
  name?: string
  favorite?: boolean
  hidden?: boolean
  /** Overrides the scanner's choice of exe; kept across rescans. */
  executablePath?: string
  // Editing any of these locks the details against automatic refreshes.
  description?: string | null
  genres?: string[]
  releaseDate?: string | null
  developer?: string | null
}

/** Whether a launched game is still starting, running, or has stopped. */
export type SessionState = 'launching' | 'running' | 'stopped'

export interface SessionChange {
  gameId: number
  state: SessionState
}
