import type { OverlaySettings } from './overlay'
import type { FriendVoice } from './voiceProtocol'
import type { VoiceSettings } from './voiceSettings'
import type { InterfaceOptions } from './interfaceOptions'
import type { ProfileStyle } from './profileStyle'
// Types shared between the main process, preload and renderer.

/** 'android': an app installed on the phone (the Android version of Vanity). */
export type GameSource = 'steam' | 'epic' | 'gog' | 'ea' | 'ubisoft' | 'macapp' | 'custom' | 'manual' | 'android'

/** Sources that have a scanner and can be toggled in settings. */
export type ScanSource = Exclude<GameSource, 'manual' | 'android'>

export const SCAN_SOURCES: ScanSource[] = ['steam', 'epic', 'gog', 'ea', 'ubisoft', 'macapp', 'custom']

/** The sources that can find anything on each kind of computer (EA and Ubisoft are read from the Windows registry; Mac apps only exist on a Mac). */
export function scanSourcesFor(os: string): ScanSource[] {
  if (os === 'darwin') return SCAN_SOURCES.filter((s) => s !== 'ea' && s !== 'ubisoft')
  return SCAN_SOURCES.filter((s) => s !== 'macapp')
}

export const SOURCE_LABELS: Record<GameSource, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG Galaxy',
  ea: 'EA app',
  ubisoft: 'Ubisoft Connect',
  macapp: 'Mac apps',
  custom: 'Custom folders',
  manual: 'Added manually',
  android: 'Android'
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
  /** False for a game you own on a linked account (Steam) but haven't installed on this device. */
  installed: boolean
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
  /** Closing the window keeps Vanity running in the background (calls, notifications, downloads carry on); quit from the icon by the clock. On unless switched off. Windows only. */
  closeToBackground: boolean
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
  /** Which parts of the launcher show, and how it looks (Settings → Customize). Kept on this device. */
  interface: InterfaceOptions
  /** Voice chat: devices, push-to-talk, sensitivity, per-person volumes. Kept on this device. */
  voice: VoiceSettings
  /** The overlay over a running game: voice pictures and notifications (Windows). Kept on this device. */
  overlay: OverlaySettings
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

/** Where a game can be bought. */
export interface GameStores {
  title: string
  stores: StoreLink[]
  /** False when the game's own store pages aren't known and `stores` is a store search for its name instead. */
  exact: boolean
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

/** Who can see a player's stats on their profile. */
export type StatsVisibility = 'everyone' | 'friends' | 'private'
export const STATS_VISIBILITY_LABELS: Record<StatsVisibility, { label: string; hint: string }> = {
  everyone: { label: 'Everyone', hint: 'Anyone signed in to Vanity can see your profile and stats.' },
  friends: { label: 'Friends', hint: 'Only your friends can see your profile and stats.' },
  private: { label: 'Only me', hint: 'Nobody else can see your profile and stats.' }
}
export const statsVisibilityOf = (v: unknown): StatsVisibility => (v === 'friends' || v === 'private' ? v : 'everyone')

export interface AccountState {
  /** This build knows where Vanity's account service is (src/shared/backend.ts). */
  available: boolean
  signedIn: boolean
  email: string | null
  /** The public name friends add you by. */
  username: string | null
  /** Signed in, but the account hasn't picked a username yet. */
  needsUsername: boolean
  /** The last session ended by itself (it expired, or was signed out elsewhere). */
  sessionExpired: boolean
  /** This device keeps you signed in after Vanity closes. */
  remembered: boolean
  /** Your profile picture (a small image as a data: address), or null for none. */
  avatar: string | null
  bio: string
  /** How your profile looks to you and everyone else (see src/shared/profileStyle.ts). */
  style: ProfileStyle
  /** Who can see your profile and stats (everyone by default). */
  statsVisibility: StatsVisibility
  /** Official badges. Only Vanity's server grants them. */
  verified: boolean
  admin: boolean
  /** When the username can next be changed (ms), or null when it can be changed now. */
  usernameChangeAt: number | null
  /** Set by Vanity's admins: banned, or timed out (no messages, comments or voice) until a time. */
  standing: AccountStanding
}

export interface AccountStanding {
  banned: boolean
  reason: string
  timeoutUntil: number | null
}
export const GOOD_STANDING: AccountStanding = { banned: false, reason: '', timeoutUntil: null }

/** What everyone may see of another account. */
export interface PublicUser {
  id: string
  username: string
  avatar: string | null
  style: ProfileStyle
  verified: boolean
  admin: boolean
}

export interface FriendStatus {
  state: 'playing' | 'online' | 'offline'
  gameName: string | null
  /** When the current game started (ms). */
  since: number | null
  /** Last heartbeat (ms). */
  lastSeen: number | null
}

/** One message in a chat with a friend. */
export interface ChatMessage {
  id: number
  /** True if you wrote it. */
  mine: boolean
  text: string
  at: number | null
  /** When the other person read it (for your own messages), or you did. */
  readAt: number | null
}

/** A page of a chat, oldest first. */
export interface ChatPage {
  messages: ChatMessage[]
  /** There are older messages before this page. */
  more: boolean
  /** The newest of your messages that your friend has read. */
  seenUpTo: number | null
}

export interface Friend extends PublicUser {
  bio: string
  /** Messages from them you haven't read yet. */
  unread: number
  /** The newest message in your chat, either way. */
  lastMessage: { id: number; text: string; at: number | null; mine: boolean } | null
  status: FriendStatus
  totalPlaytimeSeconds: number
  gamesPlayed: number
  topGame: string | null
  level: number
  xp: number
  /** Their voice room, when it's one you may see (null when they're not in one). */
  voice: FriendVoice | null
}

export interface FriendRequest extends PublicUser {
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
  launches: number
  firstPlayedAt: number | null
  favorite: boolean
  playStatus: string | null
  /** Their rating, 1–5. */
  rating: number | null
}

export interface FriendStats {
  /** Their account id (older servers may leave it out). */
  id?: string
  /** False when you're looking at the profile of someone who isn't your friend. */
  isFriend?: boolean
  username: string
  avatar: string | null
  bio: string
  style: ProfileStyle
  verified: boolean
  admin: boolean
  level: number
  xp: number
  /** Ids of the badges they've earned (see src/shared/progress.ts). */
  badges: string[]
  totalPlaytimeSeconds: number
  gamesPlayed: number
  top: FriendGameStat[]
  recent: FriendGameStat[]
  /** Badge id → when it was earned (ms). */
  badgeTimes: Record<string, number>
  /** When they joined Vanity, and when you two became friends (ms). */
  memberSince: number | null
  friendsSince: number | null
  friendCount: number
  /** Friends you both have. */
  mutualFriends: number
  launches: number
  daysPlayed: number
  currentStreak: number
  bestStreak: number
  favorites: FriendGameStat[]
  /** Games they've marked Beaten or Completed. */
  finished: number
  /** Games they've marked as playing now. */
  playing: FriendGameStat[]
  averageRating: number | null
  ratedGames: number
  steam: { name: string; profileUrl: string } | null
  /** Messages in your chat with them. */
  messages: { sent: number; received: number; firstAt: number | null }
}

export interface GameFriend extends PublicUser {
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
   * Android: 'apk' (GitHub Releases; Vanity downloads the new APK and Android installs it).
   * Running from source: the Vanity server on Vercel, or (without one) git / GitHub.
   */
  mode: 'release' | 'apk' | 'vercel' | 'git' | 'github' | 'unsupported'
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
  /**
   * The Mac app without an Apple Developer ID signature: macOS won't let it replace itself, so a
   * new version is offered as a download of the new .dmg from this page instead.
   */
  downloadUrl?: string | null
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

// ---- Progress (XP, level, badges) and cloud sync ---------------------------------

export interface ProgressBadge {
  id: string
  name: string
  description: string
  icon: string
  /** When it was unlocked (ms), or null while it's still locked. */
  unlockedAt: number | null
  current: number
  target: number
}

export interface ProgressGame {
  /** Vanity's game key. */
  key: string
  name: string
  /** Across all your devices. */
  playtimeSeconds: number
  launches: number
  lastPlayedAt: number | null
  /** The game in this device's library, or null if you only have it elsewhere. */
  gameId: number | null
  coverPath: string | null
  iconPath: string | null
}

export type SyncStatus =
  /** Not signed in (or no username yet): progress is kept on this device only. */
  | 'local'
  | 'syncing'
  | 'synced'
  /** Couldn't reach the server: changes are kept here and sent when it's back. */
  | 'offline'
  | 'error'

export interface SyncState {
  status: SyncStatus
  /** When this device last synced successfully (ms). */
  lastSyncedAt: number | null
  /** A plain-words explanation for 'offline' and 'error'. */
  message: string | null
  /** Changes when a sync brought in something new, so screens know to reload. */
  appliedAt: number
}

export interface Progress {
  xp: number
  level: { level: number; into: number; span: number; title: string }
  /** Where the XP comes from. */
  breakdown: { playtime: number; firstLaunches: number; daysPlayed: number; streaks: number; steamAchievements: number; journal: number }
  totals: {
    playtimeSeconds: number
    gamesPlayed: number
    launches: number
    daysPlayed: number
    currentStreak: number
    bestStreak: number
    favorites: number
    steamAchievements: number
  }
  /** Most played first. */
  topGames: ProgressGame[]
  /** Last played first. */
  recentGames: ProgressGame[]
  badges: ProgressBadge[]
  sync: SyncState
}

// ---- Linked Steam account ------------------------------------------------------------

export interface SteamLink {
  steamId: string
  name: string
  avatar: string | null
  profileUrl: string
  /** Linked by signing in through Steam (proof the account is yours), not just by typing an id. */
  verified: boolean
  linkedAt: number
}

export interface SteamGame {
  appId: number
  name: string
  playtimeMinutes: number
  playtimeTwoWeeksMinutes: number
  lastPlayedAt: number | null
  iconUrl: string | null
}

export interface SteamAchievement {
  id: string
  name: string
  description: string | null
  achieved: boolean
  unlockedAt: number | null
}

export interface SteamState {
  /** Signed in to Vanity with a username (linking needs an account). */
  available: boolean
  /** The Vanity server has a Steam key. Null: not asked yet. */
  configured: boolean | null
  link: SteamLink | null
  /** Steam isn't sharing this account's games ("Game details" is private). */
  gamesPrivate: boolean
  /** How to fix that, in plain words. */
  privateMessage: string | null
  /** Games in the Steam library, when Steam shares them. */
  ownedGames: number | null
  /** Achievements unlocked across played games. `complete` is false while the server is still counting. */
  achievements: { unlocked: number; total: number; complete: boolean } | null
  /** Waiting for the user to finish signing in on Steam's page in the browser. */
  signingIn: boolean
  error: string | null
}

// ---- In-launcher installs (Epic, GOG) ---------------------------------------------------

/** Stores Vanity can download and install games from by itself. */
export type DownloadStore = 'epic' | 'gog'

export type DownloadState =
  | 'queued'
  /** Working out sizes and getting ready. */
  | 'preparing'
  | 'downloading'
  | 'paused'
  /** The download is done; the game is being set up (GOG runs its installer here). */
  | 'installing'
  | 'done'
  | 'failed'

export interface DownloadItem {
  id: string
  gameId: number
  name: string
  store: DownloadStore
  state: DownloadState
  /** 0–100. */
  percent: number
  downloadedBytes: number
  /** 0 until known. */
  totalBytes: number
  /** Bytes per second right now. */
  speedBps: number
  /** Seconds left, or null when unknown. */
  etaSeconds: number | null
  /** The folder games are installed into (the game gets its own folder inside). */
  installDir: string
  /** Why it failed, in plain words. */
  error: string | null
  addedAt: number
  coverPath: string | null
}

/** What the install window shows before you confirm. */
export interface InstallPlan {
  store: DownloadStore
  /** Bytes to download and bytes the game takes once installed (0 when the store doesn't say). */
  downloadBytes: number
  installBytes: number
  installDir: string
  /** Free space on that drive, or null if it can't be read. */
  freeBytes: number | null
  /** False when the drive clearly doesn't have room. */
  enoughSpace: boolean
}

/** The Epic and GOG accounts linked on this PC (their sign-ins stay on this PC). */
export interface StoreAccounts {
  /** False on Android: installing PC games needs a PC. */
  supported: boolean
  epic: { available: boolean; signedIn: boolean; name: string | null; games: number | null; busy: boolean; error: string | null }
  gog: { signedIn: boolean; name: string | null; games: number | null; busy: boolean; error: string | null }
}

/**
 * Why a game can't be played on this computer, or null when it can. A Mac can't run Windows
 * programs, and Windows can't open Mac apps. Games started through a launcher (Steam, Epic) are
 * left to the launcher, which only lists what it can run.
 */
export function notPlayableHere(game: Pick<Game, 'source' | 'executablePath'>, os: string): string | null {
  const exe = game.executablePath ?? ''
  if (os === 'darwin') {
    if (game.source === 'ea' || game.source === 'ubisoft') return 'Windows only'
    if (game.source !== 'steam' && game.source !== 'epic' && /\.(exe|bat|cmd|msi|lnk)$/i.test(exe)) return 'Windows only'
  } else if (os === 'win32') {
    if (game.source === 'macapp' || /\.app\/?$/i.test(exe)) return 'Mac only'
  }
  return null
}
