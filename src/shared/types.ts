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
}

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
