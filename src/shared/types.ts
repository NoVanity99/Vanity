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
  // The user's own journal for the game.
  playStatus: PlayStatus | null
  /** 1–5 stars. */
  userRating: number | null
  notes: string | null
  /** IDs of the collections this game is in. */
  collections: number[]
}

/** A list of games the user made ("Co-op nights", "Backlog 2026"…). */
export interface Collection {
  id: number
  name: string
  createdAt: number
}

/** Where the user is with a game (their backlog tracker). */
export type PlayStatus = 'backlog' | 'playing' | 'beaten' | 'completed' | 'dropped'

export const PLAY_STATUSES: PlayStatus[] = ['backlog', 'playing', 'beaten', 'completed', 'dropped']

export const PLAY_STATUS_LABELS: Record<PlayStatus, string> = {
  backlog: 'Backlog',
  playing: 'Playing',
  beaten: 'Beaten',
  completed: '100% completed',
  dropped: 'Dropped'
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
  /** Colour skin ID (see src/shared/themes.ts). */
  theme: string
  /** Font theme ID (see src/shared/fonts.ts). */
  font: string
  /** Slowly drifting colour glow behind the interface. */
  ambientBackground: boolean
  /** Minimise Vanity's window while a game is running. */
  minimizeWhilePlaying: boolean
  /** Folder the mini music player plays from. */
  musicFolder: string | null
  /** Music volume, 0–1. */
  musicVolume: number
  /** Vanity account server URL (see server/README.md). Empty uses the built-in one, if any. */
  accountServerUrl: string
  /** Session token for the account server (encrypted at rest). */
  accountToken: string
  accountUsername: string
  /** Navigate the launcher with a game controller. */
  controllerEnabled: boolean
  /** GitHub token for updates when Vanity isn't a git checkout (encrypted at rest). */
  githubToken: string
  /** Show what you're playing and listening to on your Discord profile. */
  discordPresence: boolean
  /** Application ID of your "Vanity" app in the Discord developer portal. */
  discordClientId: string
  /** Sent to the update server when it has UPDATE_KEY set (encrypted at rest). */
  updateKey: string
  /** Remind you to take a break every this many minutes of play; 0 = off. */
  breakReminderMinutes: number
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
  // Journal fields (never lock anything).
  playStatus?: PlayStatus | null
  userRating?: number | null
  notes?: string | null
}

/** Whether a launched game is still starting, running, or has stopped. */
export type SessionState = 'launching' | 'running' | 'stopped'

export interface SessionChange {
  gameId: number
  state: SessionState
}

// ---- Trending ---------------------------------------------------------------

/** Stores a trending game can be opened in. Add new ones in src/main/trending/launcherLinks.ts. */
export type StoreLauncher = 'steam' | 'epic' | 'ea' | 'ubisoft' | 'battlenet' | 'gog' | 'microsoft'

export const STORE_LABELS: Record<StoreLauncher, string> = {
  steam: 'Steam',
  epic: 'Epic Games Store',
  ea: 'EA app',
  ubisoft: 'Ubisoft Connect',
  battlenet: 'Battle.net',
  gog: 'GOG Galaxy',
  microsoft: 'Microsoft Store'
}

export interface StoreLink {
  launcher: StoreLauncher
  /** The store's own ID (Steam app ID, Epic slug, GOG product ID or slug, Microsoft product ID…), if known. */
  storeId: string | null
  /** URI that opens the launcher on the game's page, if the launcher supports one. */
  deepLink: string | null
  /** The game's page on the store's website (always set; the browser fallback). */
  webUrl: string
}

export interface PopularityStat {
  kind: 'players' | 'viewers' | 'igdb'
  /** Current Steam players or Twitch viewers; null for 'igdb'. */
  value: number | null
}

export interface TrendingGame {
  /** IGDB game ID. */
  id: number
  title: string
  coverUrl: string | null
  rank: number
  popularityStat: PopularityStat
  stores: StoreLink[]
}

/** An upcoming PC game for the "Coming soon" banner. */
export interface UpcomingGame {
  id: number
  title: string
  /** Wide artwork or screenshot for the banner. */
  bannerUrl: string | null
  coverUrl: string | null
  /** ISO date (YYYY-MM-DD). */
  releaseDate: string
  /** IGDB "hypes": people following it before release. Higher = more anticipated. */
  hype: number
  stores: StoreLink[]
  /** 1 = most hyped. */
  hypeRank: number
  genres: string[]
}

export interface TrendingState {
  games: TrendingGame[]
  upcoming: UpcomingGame[]
  /** When the cached list was fetched (ms), or null if never. */
  updatedAt: number | null
  refreshing: boolean
  /** Why the last refresh failed, if it did. Cached games may still be shown. */
  error: string | null
  /** The error is about missing credentials (the user needs to add keys). */
  needsKeys: boolean
  /** Upcoming games the user follows for a release reminder. */
  followed: number[]
}

// ---- Launcher status -------------------------------------------------------

export interface LauncherStatus {
  launcher: StoreLauncher
  state: 'online' | 'offline' | 'unknown'
  /** Extra detail for the tooltip ("Minor service outage", "Couldn't connect"…). */
  detail: string | null
  checkedAt: number | null
}

// ---- Live stats --------------------------------------------------------------

export interface GameLive {
  /** Current players on Steam, if the game is on Steam. */
  players: number | null
  /** Live Twitch viewers (needs Twitch credentials). */
  viewers: number | null
  /** Steam app ID used for live stats and the Workshop, if known. */
  steamAppId: string | null
  /** The game has a Steam Workshop (only offered for Steam copies). */
  workshop: boolean
  checkedAt: number
}

// ---- Accounts and friends ------------------------------------------------------

export interface AccountState {
  /** A server URL is set (in Settings or built in). */
  serverConfigured: boolean
  serverUrl: string
  signedIn: boolean
  username: string | null
}

export interface FriendStatus {
  state: 'playing' | 'online' | 'offline'
  gameName: string | null
  /** When the current game started (ms). */
  since: number | null
  /** Last heartbeat (ms). */
  lastSeen: number | null
}

export interface Friend {
  id: string
  username: string
  status: FriendStatus
  totalPlaytimeSeconds: number
  gamesPlayed: number
  topGame: string | null
}

export interface FriendRequest {
  id: string
  username: string
  createdAt: number | null
}

export interface FriendsList {
  friends: Friend[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
}

export interface FriendGameStat {
  gameKey: string
  gameName: string
  playtimeSeconds: number
  lastPlayedAt: number | null
}

export interface FriendStats {
  username: string
  totalPlaytimeSeconds: number
  gamesPlayed: number
  top: FriendGameStat[]
  recent: FriendGameStat[]
}

export interface GameFriend {
  id: string
  username: string
  playtimeSeconds: number
  lastPlayedAt: number | null
}

// ---- Game page: your stats and extra details ---------------------------------

export interface GameSession {
  startedAt: number
  endedAt: number | null
  seconds: number
}

/** Playtime facts for one game, from recorded sessions. */
export interface GamePlayStats {
  sessions: number
  averageSeconds: number
  longest: { seconds: number; startedAt: number } | null
  firstPlayedAt: number | null
  /** Position by playtime among played games (1 = most played); null if never played. */
  rank: number | null
  playedGames: number
  /** This game's share of all playtime in the library, 0–1. */
  share: number
  /** Newest first, at most 500. */
  history: GameSession[]
}

export interface Rating {
  /** 0–100. */
  score: number
  count: number
}

export interface GameDetails {
  ratings: {
    critics: Rating | null
    players: Rating | null
    metacritic: { score: number; url: string | null } | null
    /** Steam user reviews: "Very Positive" and the counts behind it. */
    steam: { label: string; positive: number; total: number } | null
  }
  /** How long it takes to finish, in seconds (IGDB community times). */
  timeToBeat: { main: number | null; extra: number | null; completionist: number | null; count: number } | null
  storyline: string | null
  developers: string[]
  publishers: string[]
  franchise: string | null
  modes: string[]
  perspectives: string[]
  themes: string[]
  platforms: string[]
  /** Steam store features ("Controller support", "Steam Cloud"…). */
  features: string[]
  languages: string[]
  achievements: number | null
  dlcCount: number | null
  /** "Free", "$19.99", or null. */
  price: string | null
  requirements: { minimum: string | null; recommended: string | null } | null
  website: string | null
  screenshots: { thumb: string; full: string }[]
  /** YouTube trailers. */
  videos: { id: string; name: string }[]
  similar: { igdbId: number; name: string; coverUrl: string | null; libraryId: number | null }[]
  news: { title: string; url: string; date: number; source: string; excerpt: string }[]
  /** Which services answered. */
  sources: { igdb: boolean; steam: boolean }
  fetchedAt: number
}

// ---- Updates ---------------------------------------------------------------------

export interface UpdateNote {
  version: string
  /** ISO date, if the changelog gives one. */
  date: string | null
  changes: string[]
}

export interface UpdateState {
  current: string
  latest: string | null
  /** A newer version is on GitHub and can be applied. */
  available: boolean
  /** Patch notes for every version newer than this one, newest first. */
  notes: UpdateNote[]
  /**
   * Where updates come from. Installed copies: 'release' (GitHub Releases, installed by the Windows installer).
   * Running from source: the Vanity server on Vercel, or (without one) git / GitHub.
   */
  mode: 'release' | 'vercel' | 'git' | 'github' | 'unsupported'
  branch: string
  /** Where updates come from, for Settings (server URL or GitHub repo). */
  source: string
  checking: boolean
  lastChecked: number | null
  error: string | null
  /** Updates need a GitHub token (the repo is private and this isn't a git clone). */
  needsToken: boolean
  /** While installing: what it's doing now. */
  applying: string | null
  /** Installed copies: download progress of a new version, 0–100, while it downloads in the background. */
  progress?: number | null
}

/** What the mini player shows for the current song. */
export interface TrackInfo {
  title: string
  artist: string | null
  album: string | null
  hasArt: boolean
}

// ---- Discord ---------------------------------------------------------------------

export interface DiscordStatus {
  state: 'off' | 'needs-id' | 'connecting' | 'connected' | 'unavailable'
  /** Your Discord name, once connected. */
  user: string | null
  error: string | null
}

/** The song the mini player is playing, for Discord. */
export interface NowListening {
  title: string
  artist: string | null
  /** When the song started (ms), adjusted for where playback is. */
  startedAt: number
  durationMs: number | null
}
