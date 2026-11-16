import type { ProfileStyle } from './profileStyle'
import type {
  ChatMessage,
  ChatPage,
  GameStores,
  AccountState,
  DownloadItem,
  InstallPlan,
  StoreAccounts,
  SteamState,
  SteamGame,
  SteamAchievement,
  Progress,
  FriendsList,
  FriendStats,
  GameFriend,
  ArtworkKind,
  ArtworkOption,
  Game,
  GameCandidate,
  GameDetails,
  GamePlayStats,
  GameLive,
  GamePatch,
  KeyCheck,
  LauncherStatus,
  MatchCandidate,
  MetadataProgress,
  ScanProgress,
  ScanSummary,
  SessionChange,
  SessionState,
  Settings,
  StoreLauncher,
  TrendingState,
  UpdateState,
  TrackInfo,
  DiscordStatus,
  NowListening,
  Collection
} from './types'

export interface PlayStats {
  totalSeconds: number
  gamesPlayed: number
  sessions: number
  longest: { seconds: number; gameId: number; name: string; startedAt: number } | null
  top: { id: number; name: string; seconds: number; coverPath: string | null }[]
  /** Sessions from the last year, oldest first. */
  recent: { startedAt: number; seconds: number; gameId: number }[]
  /** Each game's first-ever session (ms), by game ID. */
  firstPlayed: Record<number, number>
}

export interface MusicState {
  folder: string | null
  count: number
  /** Changes on every rescan; part of track URLs so old ones aren't reused. */
  version: number
}

/** For calls that can fail in ways the user should see: either data or a readable error. */
export type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: string }

/** The API the preload script exposes to the renderer as `window.vanity`. */
/** An app installed on the phone that could be added as a game (Android). */
export interface InstalledApp {
  packageName: string
  name: string
  /** A file:// path to the app's icon, if available. */
  icon: string | null
}

export interface VanityApi {
  /** Which version of Vanity this is: the Windows desktop app or the Android app. */
  platform: 'desktop' | 'android'
  /** Shows a system notification (on Windows; Android shows these inside the app only). Clicking it brings Vanity forward. */
  notify(title: string, body: string): Promise<void>
  games: {
    list(): Promise<Game[]>
    get(id: number): Promise<Game | null>
    /** The library changed in the background (owned games arrived, an install finished). */
    onChanged(callback: () => void): () => void
    /**
     * Installs a game you own but haven't installed. Resolves with a sentence about what happens
     * next (Steam games install through the Steam client).
     */
    install(id: number): Promise<Result<{ note: string }>>
    /** A game whose install was started from Vanity is installed now. */
    onInstalled(callback: (game: Game) => void): () => void
    update(id: number, patch: GamePatch): Promise<Game | null>
    /** Removes a game from the library. Scans skip it from then on, until it's restored. */
    remove(id: number): Promise<void>
    /** Names of the games you removed (which scans are skipping). */
    removed(): Promise<string[]>
    /** Lets scans add removed games back. Resolves to how many were restored. */
    restoreRemoved(): Promise<number>
    /** Opens the game's install folder in Explorer. Resolves to an error message, or null on success. */
    openFolder(id: number): Promise<string | null>
    /** Starts the game. Resolves to an error message, or null on success. */
    launch(id: number): Promise<string | null>
    /** Opens a file picker to choose the game's exe. Resolves to the updated game, or null if cancelled. */
    pickExecutable(id: number): Promise<Game | null>
    /** Adds the confirmed custom-folder candidates and ignores the rest. */
    confirmCandidates(accepted: GameCandidate[], rejected: GameCandidate[]): Promise<Game[]>
    /** Opens a file picker for an .exe. Resolves to null if cancelled. */
    addManually(): Promise<Game | null>
    /** Android: apps on the phone that aren't in the library yet (for "Add a game"). Empty on desktop. */
    installedApps(): Promise<InstalledApp[]>
    /** Android: adds an installed app to the library as a game. */
    addApp(packageName: string): Promise<Game | null>
    /** Sessions, averages and rank for one game. */
    playStats(id: number): Promise<GamePlayStats>
    /** Ratings, time to beat, credits, media, news and similar games (cached; `refresh` refetches). */
    details(id: number, refresh?: boolean): Promise<GameDetails | null>
    /** Size of the install folder in bytes, or null if unknown. */
    diskSize(id: number): Promise<number | null>
    /** Cover pictures for games by name (for games that aren't in your library, e.g. a friend's). Name → image address, or null. */
    coversByName(names: string[]): Promise<Record<string, string | null>>
  }
  collections: {
    list(): Promise<Collection[]>
    create(name: string): Promise<Result<Collection>>
    rename(id: number, name: string): Promise<Result<Collection | null>>
    remove(id: number): Promise<void>
    /** Adds a game to a collection or takes it out; resolves to the updated game. */
    setMember(collectionId: number, gameId: number, member: boolean): Promise<Result<Game | null>>
  }
  playtime: {
    /**
     * Android: whether Vanity may read app usage, which makes playtime exact and counts games
     * opened outside Vanity. Null on desktop, where playtime is always tracked.
     */
    usageAccess(): Promise<boolean | null>
    /** Android: opens the system's "Usage access" settings. */
    openUsageSettings(): Promise<void>
  }
  sessions: {
    /** Games currently launching or running, by game ID. */
    states(): Promise<Record<number, Exclude<SessionState, 'stopped'>>>
    /**
     * Cancels a game that is starting, or force-closes one that is running (like "End task").
     * Unsaved progress in the game is lost. Resolves to how many of its processes were closed.
     */
    stop(gameId: number): Promise<Result<{ wasRunning: boolean; closed: number }>>
    onChange(callback: (change: SessionChange) => void): () => void
  }
  metadata: {
    progress(): Promise<MetadataProgress>
    onProgress(callback: (progress: MetadataProgress) => void): () => void
    /** A game's metadata or artwork changed in the background. */
    onGameUpdated(callback: (gameId: number) => void): () => void
    /** Re-matches and refetches one game. */
    refresh(id: number): Promise<Result<Game | null>>
    refreshAll(): Promise<void>
    search(query: string): Promise<Result<MatchCandidate[]>>
    applyMatch(id: number, candidate: MatchCandidate): Promise<Result<Game | null>>
    artworkOptions(id: number, kind: ArtworkKind): Promise<Result<ArtworkOption[]>>
    setArtwork(id: number, kind: ArtworkKind, url: string): Promise<Result<Game | null>>
    /** Opens an image picker. data is null if cancelled. */
    setArtworkFromFile(id: number, kind: ArtworkKind): Promise<Result<Game | null>>
    resetArtwork(id: number, kind: ArtworkKind): Promise<Result<Game | null>>
    checkKeys(): Promise<{ steamGridDb: KeyCheck; igdb: KeyCheck }>
  }
  trending: {
    /** The cached list straight away (refreshes in the background if it's old). */
    get(): Promise<TrendingState>
    refresh(): Promise<TrendingState>
    onUpdate(callback: (state: TrendingState) => void): () => void
    /** Which launchers are installed on this PC. */
    installed(): Promise<Record<StoreLauncher, boolean>>
    /** The stores a game is sold on, by its IGDB id (for games that aren't on the Trending lists). Open one with `open`. */
    stores(igdbId: number, name: string): Promise<Result<GameStores>>
    /** Opens a trending game in a store: the launcher if installed, otherwise the browser. */
    open(gameId: number, launcher: StoreLauncher): Promise<Result<'launcher' | 'browser'>>
    /** Follows (or unfollows) an upcoming game: Vanity reminds you when it comes out. */
    follow(gameId: number, on: boolean): Promise<TrendingState>
  }
  account: {
    state(): Promise<AccountState>
    onChange(callback: (state: AccountState) => void): () => void
    /** Creates an account (email + password at Neon Auth) with a public username. */
    signUp(email: string, username: string, password: string, remember: boolean): Promise<Result<AccountState>>
    /** `remember` false: signed in only until Vanity closes. */
    signIn(email: string, password: string, remember: boolean): Promise<Result<AccountState>>
    signOut(): Promise<AccountState>
    /** Whether a username and an email are free (true), already in use (false), or couldn't be checked (null). */
    availability(input: { username?: string; email?: string }): Promise<{ username: boolean | null; email: boolean | null }>
    /** Picks the username of a new account, or renames it. */
    setUsername(username: string): Promise<Result<AccountState>>
    /** Sets your profile picture (a small image as a data: address; null removes it), your bio and/or your profile's look. */
    setProfile(patch: { avatar?: string | null; bio?: string; style?: Partial<ProfileStyle> }): Promise<Result<AccountState>>
    /** Emails a 6-digit code for choosing a new password. */
    sendResetCode(email: string): Promise<Result<true>>
    resetPassword(email: string, code: string, password: string): Promise<Result<true>>
    /** Removes your Vanity profile, friends and shared stats. */
    deleteAccount(): Promise<Result<AccountState>>
  }
  /** Voice chat: the server address, a sign-in token for it, and the push-to-talk key. */
  voice: {
    /** The voice server to use: the one in Settings → Voice, else the one built into this copy ('' for none). */
    serverUrl(): Promise<{ url: string; builtIn: string }>
    /** A fresh Vanity sign-in token, which the voice server checks. */
    token(): Promise<Result<string>>
    /** The push-to-talk key going down and up, from anywhere (a game in front included). */
    onPushToTalk(callback: (down: boolean) => void): () => void
    /** Whether the push-to-talk key works while a game is in front. */
    hotkeyStatus(): Promise<{ global: boolean; message: string | null }>
  }
  /** XP, level, badges and totals, and the state of cloud sync. Works signed out too (this device only). */
  progress: {
    get(): Promise<Progress>
    onChange(callback: (progress: Progress) => void): () => void
    /** Syncs with the cloud now. Resolves with the result (never rejects). */
    syncNow(): Promise<Progress>
  }
  /** Installing Epic and GOG games inside Vanity (Windows only). */
  downloads: {
    list(): Promise<DownloadItem[]>
    onChange(callback: (items: DownloadItem[]) => void): () => void
    /** Sizes, the folder and free space, before you confirm. Leave `installDir` out for the last folder used. */
    plan(gameId: number, installDir?: string): Promise<Result<InstallPlan>>
    start(gameId: number, installDir: string): Promise<Result<DownloadItem>>
    pause(id: string): Promise<void>
    resume(id: string): Promise<void>
    /** Stops it and deletes what it had downloaded. */
    cancel(id: string): Promise<void>
    clearFinished(): Promise<void>
    /** Shows the downloader's log file in Explorer (for troubleshooting). */
    showLog(): Promise<void>
  }
  /** The Epic and GOG accounts linked on this PC. */
  stores: {
    state(): Promise<StoreAccounts>
    onChange(callback: (state: StoreAccounts) => void): () => void
    refresh(): Promise<StoreAccounts>
    /** Opens Epic's sign-in page in a window. */
    epicLogin(): Promise<Result<StoreAccounts>>
    /** Signs in with the "authorizationCode" from Epic's sign-in page, pasted by hand. */
    epicLoginWithCode(code: string): Promise<Result<StoreAccounts>>
    epicLogout(): Promise<StoreAccounts>
    gogLogin(): Promise<Result<StoreAccounts>>
    gogLogout(): Promise<StoreAccounts>
  }
  /** Your linked Steam account. The Steam key is on the Vanity server, never in the app. */
  steam: {
    state(): Promise<SteamState>
    onChange(callback: (state: SteamState) => void): () => void
    /** Links from a SteamID64, a profile link, or a custom URL name. */
    link(input: string): Promise<Result<SteamState>>
    /** Opens Steam's sign-in page in the browser; the link appears when you finish there. */
    signIn(): Promise<Result<SteamState>>
    cancelSignIn(): Promise<SteamState>
    unlink(): Promise<Result<SteamState>>
    refresh(): Promise<SteamState>
    ownedGames(): Promise<Result<SteamGame[]>>
    recentGames(): Promise<Result<SteamGame[]>>
    achievements(appId: number): Promise<Result<SteamAchievement[]>>
  }
  friends: {
    list(): Promise<Result<FriendsList>>
    add(username: string): Promise<Result<'pending' | 'accepted'>>
    accept(id: string): Promise<Result<true>>
    /** Declines an incoming request or cancels an outgoing one. */
    decline(id: string): Promise<Result<true>>
    remove(id: string): Promise<Result<true>>
    stats(id: string): Promise<Result<FriendStats>>
    /** A page of your chat with a friend (reading it marks their messages as read). */
    messages(id: string, opts?: { before?: number; after?: number; limit?: number }): Promise<Result<ChatPage>>
    /** Sends a message to a friend. Messages are kept for good. */
    send(id: string, text: string): Promise<Result<ChatMessage>>
    /** Friends who have played a library game. */
    forGame(gameId: number): Promise<Result<GameFriend[]>>
  }
  stats: {
    /** Playtime totals, top games and recent sessions. */
    get(): Promise<PlayStats>
  }
  live: {
    /** Live players/viewers and Workshop availability for one game (cached ~10 min). */
    game(id: number): Promise<GameLive | null>
    /** Current Steam players for Steam games in the library, by game ID. */
    library(): Promise<Record<number, number>>
    /** Opens the game's Steam Workshop in the Steam client. */
    openWorkshop(id: number): Promise<Result<true>>
  }
  music: {
    /** The music folder and how many tracks it has. */
    state(): Promise<MusicState>
    /** Title, artist and artwork availability for a track. */
    track(index: number): Promise<TrackInfo | null>
    /** Address the player loads a track from. `version` is MusicState.version. */
    url(index: number, version: number): string
    /** Address of a track's artwork. */
    artUrl(index: number, version: number): string
    /** Opens a folder picker, then scans it. Resolves to the new state, or null if cancelled. */
    pickFolder(): Promise<MusicState | null>
  }
  status: {
    /** Latest known status of each launcher's services. */
    get(): Promise<LauncherStatus[]>
    refresh(): Promise<LauncherStatus[]>
    onUpdate(callback: (statuses: LauncherStatus[]) => void): () => void
  }
  window: {
    /** Big Picture mode: fill the screen. */
    setFullScreen(on: boolean): Promise<void>
  }
  discord: {
    status(): Promise<DiscordStatus>
    onStatus(callback: (status: DiscordStatus) => void): () => void
    /** What the music player is playing (null when paused or stopped). */
    setListening(now: NowListening | null): void
  }
  update: {
    state(): Promise<UpdateState>
    /** Looks for a new version now. */
    check(): Promise<UpdateState>
    /** Installs the new version and restarts Vanity. */
    apply(): Promise<Result<true>>
    onChange(callback: (state: UpdateState) => void): () => void
  }
  scan: {
    start(): Promise<ScanSummary>
    onProgress(callback: (progress: ScanProgress[]) => void): () => void
  }
  settings: {
    /** Settings changed without the user doing it here (cloud sync brought them from another device). */
    onChange(callback: (settings: Settings) => void): () => void
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
    /** Opens a folder picker. Resolves to null if cancelled. */
    pickFolder(): Promise<string | null>
  }
}

/** IPC channel names, shared by the main process and preload. */
export const IPC = {
  gamesList: 'games:list',
  gamesGet: 'games:get',
  gamesChanged: 'games:changed',
  gamesInstall: 'games:install',
  gamesInstalled: 'games:installed',
  gamesUpdate: 'games:update',
  gamesRemove: 'games:remove',
  gamesRemoved: 'games:removed',
  gamesRestoreRemoved: 'games:restore-removed',
  gamesOpenFolder: 'games:open-folder',
  gamesLaunch: 'games:launch',
  gamesPickExecutable: 'games:pick-executable',
  gamesPlayStats: 'games:play-stats',
  gamesDetails: 'games:details',
  gamesDiskSize: 'games:disk-size',
  gamesCoversByName: 'games:covers-by-name',
  friendsMessages: 'friends:messages',
  friendsSend: 'friends:send',
  appNotify: 'app:notify',
  sessionsStates: 'sessions:states',
  collectionsList: 'collections:list',
  collectionsCreate: 'collections:create',
  collectionsRename: 'collections:rename',
  collectionsRemove: 'collections:remove',
  collectionsSetMember: 'collections:set-member',
  metadataProgress: 'metadata:progress',
  metadataProgressChanged: 'metadata:progress-changed',
  metadataGameUpdated: 'metadata:game-updated',
  metadataRefresh: 'metadata:refresh',
  metadataRefreshAll: 'metadata:refresh-all',
  metadataSearch: 'metadata:search',
  metadataApplyMatch: 'metadata:apply-match',
  metadataArtworkOptions: 'metadata:artwork-options',
  metadataSetArtwork: 'metadata:set-artwork',
  metadataSetArtworkFromFile: 'metadata:set-artwork-from-file',
  metadataResetArtwork: 'metadata:reset-artwork',
  metadataCheckKeys: 'metadata:check-keys',
  trendingGet: 'trending:get',
  trendingRefresh: 'trending:refresh',
  trendingUpdated: 'trending:updated',
  trendingInstalled: 'trending:installed',
  trendingOpen: 'trending:open',
  trendingStores: 'trending:stores',
  trendingFollow: 'trending:follow',
  statsGet: 'stats:get',
  progressGet: 'progress:get',
  progressChanged: 'progress:changed',
  progressSyncNow: 'progress:sync-now',
  settingsChanged: 'settings:changed',
  sessionsStop: 'sessions:stop',
  downloadsList: 'downloads:list',
  downloadsChanged: 'downloads:changed',
  downloadsPlan: 'downloads:plan',
  downloadsStart: 'downloads:start',
  downloadsPause: 'downloads:pause',
  downloadsResume: 'downloads:resume',
  downloadsCancel: 'downloads:cancel',
  downloadsClearFinished: 'downloads:clear-finished',
  downloadsShowLog: 'downloads:show-log',
  storesState: 'stores:state',
  storesChanged: 'stores:changed',
  storesRefresh: 'stores:refresh',
  storesEpicLogin: 'stores:epic-login',
  storesEpicLoginWithCode: 'stores:epic-login-code',
  storesEpicLogout: 'stores:epic-logout',
  storesGogLogin: 'stores:gog-login',
  storesGogLogout: 'stores:gog-logout',
  steamState: 'steam:state',
  steamChanged: 'steam:changed',
  steamLink: 'steam:link',
  steamSignIn: 'steam:sign-in',
  steamCancelSignIn: 'steam:cancel-sign-in',
  steamUnlink: 'steam:unlink',
  steamRefresh: 'steam:refresh',
  steamOwnedGames: 'steam:owned-games',
  steamRecentGames: 'steam:recent-games',
  steamAchievements: 'steam:achievements',
  accountState: 'account:state',
  accountChanged: 'account:changed',
  accountSignUp: 'account:sign-up',
  accountSignIn: 'account:sign-in',
  accountSignOut: 'account:sign-out',
  accountSetUsername: 'account:set-username',
  accountAvailability: 'account:availability',
  voiceServerUrl: 'voice:server-url',
  voiceToken: 'voice:token',
  voicePushToTalk: 'voice:push-to-talk',
  voiceHotkeyStatus: 'voice:hotkey-status',
  accountSetProfile: 'account:set-profile',
  accountSendResetCode: 'account:send-reset-code',
  accountResetPassword: 'account:reset-password',
  accountDelete: 'account:delete',
  friendsList: 'friends:list',
  friendsAdd: 'friends:add',
  friendsAccept: 'friends:accept',
  friendsDecline: 'friends:decline',
  friendsRemove: 'friends:remove',
  friendsStats: 'friends:stats',
  friendsForGame: 'friends:for-game',
  liveGame: 'live:game',
  liveLibrary: 'live:library',
  liveOpenWorkshop: 'live:open-workshop',
  musicState: 'music:state',
  musicPickFolder: 'music:pick-folder',
  musicTrack: 'music:track',
  statusGet: 'status:get',
  statusRefresh: 'status:refresh',
  statusUpdated: 'status:updated',
  sessionsChanged: 'sessions:changed',
  gamesConfirmCandidates: 'games:confirm-candidates',
  gamesAddManually: 'games:add-manually',
  windowFullScreen: 'window:full-screen',
  discordStatus: 'discord:status',
  discordStatusChanged: 'discord:status-changed',
  discordListening: 'discord:listening',
  updateState: 'update:state',
  updateCheck: 'update:check',
  updateApply: 'update:apply',
  updateChanged: 'update:changed',
  scanStart: 'scan:start',
  scanProgress: 'scan:progress',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsPickFolder: 'settings:pick-folder'
} as const
