import type {
  AccountState,
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
  TrackInfo
} from './types'

export interface PlayStats {
  totalSeconds: number
  gamesPlayed: number
  sessions: number
  longest: { seconds: number; gameId: number; name: string; startedAt: number } | null
  top: { id: number; name: string; seconds: number; coverPath: string | null }[]
  recent: { startedAt: number; seconds: number }[]
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
export interface VanityApi {
  games: {
    list(): Promise<Game[]>
    get(id: number): Promise<Game | null>
    update(id: number, patch: GamePatch): Promise<Game | null>
    /** Removes a game from the library. A launcher game comes back on the next scan if it is still installed. */
    remove(id: number): Promise<void>
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
    /** Sessions, averages and rank for one game. */
    playStats(id: number): Promise<GamePlayStats>
    /** Ratings, time to beat, credits, media, news and similar games (cached; `refresh` refetches). */
    details(id: number, refresh?: boolean): Promise<GameDetails | null>
    /** Size of the install folder in bytes, or null if unknown. */
    diskSize(id: number): Promise<number | null>
  }
  sessions: {
    /** Games currently launching or running, by game ID. */
    states(): Promise<Record<number, Exclude<SessionState, 'stopped'>>>
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
    /** Opens a trending game in a store: the launcher if installed, otherwise the browser. */
    open(gameId: number, launcher: StoreLauncher): Promise<Result<'launcher' | 'browser'>>
    /** Follows (or unfollows) an upcoming game: Vanity reminds you when it comes out. */
    follow(gameId: number, on: boolean): Promise<TrendingState>
  }
  account: {
    state(): Promise<AccountState>
    onChange(callback: (state: AccountState) => void): () => void
    /** Sets (and checks) the account server URL. Signs out of the previous server. */
    setServer(url: string): Promise<Result<AccountState>>
    register(username: string, password: string): Promise<Result<AccountState>>
    login(username: string, password: string): Promise<Result<AccountState>>
    logout(): Promise<AccountState>
    deleteAccount(): Promise<Result<AccountState>>
  }
  friends: {
    list(): Promise<Result<FriendsList>>
    add(username: string): Promise<Result<'pending' | 'accepted'>>
    accept(id: string): Promise<Result<true>>
    /** Declines an incoming request or cancels an outgoing one. */
    decline(id: string): Promise<Result<true>>
    remove(id: string): Promise<Result<true>>
    stats(id: string): Promise<Result<FriendStats>>
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
    /** Title, artist and artwork availability for a track (artwork is at vanity-music://art/<index>). */
    track(index: number): Promise<TrackInfo | null>
    /** Opens a folder picker, then scans it. Resolves to the new state, or null if cancelled. */
    pickFolder(): Promise<MusicState | null>
  }
  status: {
    /** Latest known status of each launcher's services. */
    get(): Promise<LauncherStatus[]>
    refresh(): Promise<LauncherStatus[]>
    onUpdate(callback: (statuses: LauncherStatus[]) => void): () => void
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
  gamesUpdate: 'games:update',
  gamesRemove: 'games:remove',
  gamesOpenFolder: 'games:open-folder',
  gamesLaunch: 'games:launch',
  gamesPickExecutable: 'games:pick-executable',
  gamesPlayStats: 'games:play-stats',
  gamesDetails: 'games:details',
  gamesDiskSize: 'games:disk-size',
  sessionsStates: 'sessions:states',
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
  trendingFollow: 'trending:follow',
  statsGet: 'stats:get',
  accountState: 'account:state',
  accountChanged: 'account:changed',
  accountSetServer: 'account:set-server',
  accountRegister: 'account:register',
  accountLogin: 'account:login',
  accountLogout: 'account:logout',
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
