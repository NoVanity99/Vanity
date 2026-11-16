import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type VanityApi } from '@shared/ipc'
import type { AccountState, DownloadItem, Game, SteamState, StoreAccounts, Progress, Settings, LauncherStatus, MetadataProgress, ScanProgress, SessionChange, TrendingState, UpdateState, DiscordStatus } from '@shared/types'

const api: VanityApi = {
  platform: 'desktop',
  notify: (title, body) => ipcRenderer.invoke(IPC.appNotify, title, body),
  games: {
    list: () => ipcRenderer.invoke(IPC.gamesList),
    get: (id) => ipcRenderer.invoke(IPC.gamesGet, id),
    onChanged: (callback) => {
      const listener = (): void => callback()
      ipcRenderer.on(IPC.gamesChanged, listener)
      return () => ipcRenderer.removeListener(IPC.gamesChanged, listener)
    },
    install: (id) => ipcRenderer.invoke(IPC.gamesInstall, id),
    onInstalled: (callback) => {
      const listener = (_: Electron.IpcRendererEvent, game: Game): void => callback(game)
      ipcRenderer.on(IPC.gamesInstalled, listener)
      return () => ipcRenderer.removeListener(IPC.gamesInstalled, listener)
    },
    update: (id, patch) => ipcRenderer.invoke(IPC.gamesUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.gamesRemove, id),
    removed: () => ipcRenderer.invoke(IPC.gamesRemoved),
    restoreRemoved: () => ipcRenderer.invoke(IPC.gamesRestoreRemoved),
    openFolder: (id) => ipcRenderer.invoke(IPC.gamesOpenFolder, id),
    launch: (id) => ipcRenderer.invoke(IPC.gamesLaunch, id),
    pickExecutable: (id) => ipcRenderer.invoke(IPC.gamesPickExecutable, id),
    confirmCandidates: (accepted, rejected) => ipcRenderer.invoke(IPC.gamesConfirmCandidates, accepted, rejected),
    addManually: () => ipcRenderer.invoke(IPC.gamesAddManually),
    // Android only: the desktop app adds games by file.
    installedApps: async () => [],
    addApp: async () => null,
    playStats: (id) => ipcRenderer.invoke(IPC.gamesPlayStats, id),
    details: (id, refresh) => ipcRenderer.invoke(IPC.gamesDetails, id, refresh === true),
    diskSize: (id) => ipcRenderer.invoke(IPC.gamesDiskSize, id),
    coversByName: (names) => ipcRenderer.invoke(IPC.gamesCoversByName, names)
  },
  collections: {
    list: () => ipcRenderer.invoke(IPC.collectionsList),
    create: (name) => ipcRenderer.invoke(IPC.collectionsCreate, name),
    rename: (id, name) => ipcRenderer.invoke(IPC.collectionsRename, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.collectionsRemove, id),
    setMember: (collectionId, gameId, member) => ipcRenderer.invoke(IPC.collectionsSetMember, collectionId, gameId, member)
  },
  playtime: {
    usageAccess: async () => null,
    openUsageSettings: async () => {}
  },
  sessions: {
    states: () => ipcRenderer.invoke(IPC.sessionsStates),
    stop: (gameId) => ipcRenderer.invoke(IPC.sessionsStop, gameId),
    onChange(callback) {
      const listener = (_: Electron.IpcRendererEvent, c: SessionChange): void => callback(c)
      ipcRenderer.on(IPC.sessionsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.sessionsChanged, listener)
    }
  },
  metadata: {
    progress: () => ipcRenderer.invoke(IPC.metadataProgress),
    onProgress(callback) {
      const listener = (_: Electron.IpcRendererEvent, p: MetadataProgress): void => callback(p)
      ipcRenderer.on(IPC.metadataProgressChanged, listener)
      return () => ipcRenderer.removeListener(IPC.metadataProgressChanged, listener)
    },
    onGameUpdated(callback) {
      const listener = (_: Electron.IpcRendererEvent, id: number): void => callback(id)
      ipcRenderer.on(IPC.metadataGameUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.metadataGameUpdated, listener)
    },
    refresh: (id) => ipcRenderer.invoke(IPC.metadataRefresh, id),
    refreshAll: () => ipcRenderer.invoke(IPC.metadataRefreshAll),
    search: (query) => ipcRenderer.invoke(IPC.metadataSearch, query),
    applyMatch: (id, candidate) => ipcRenderer.invoke(IPC.metadataApplyMatch, id, candidate),
    artworkOptions: (id, kind) => ipcRenderer.invoke(IPC.metadataArtworkOptions, id, kind),
    setArtwork: (id, kind, url) => ipcRenderer.invoke(IPC.metadataSetArtwork, id, kind, url),
    setArtworkFromFile: (id, kind) => ipcRenderer.invoke(IPC.metadataSetArtworkFromFile, id, kind),
    resetArtwork: (id, kind) => ipcRenderer.invoke(IPC.metadataResetArtwork, id, kind),
    checkKeys: () => ipcRenderer.invoke(IPC.metadataCheckKeys)
  },
  trending: {
    get: () => ipcRenderer.invoke(IPC.trendingGet),
    refresh: () => ipcRenderer.invoke(IPC.trendingRefresh),
    onUpdate(callback) {
      const listener = (_: Electron.IpcRendererEvent, s: TrendingState): void => callback(s)
      ipcRenderer.on(IPC.trendingUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.trendingUpdated, listener)
    },
    installed: () => ipcRenderer.invoke(IPC.trendingInstalled),
    stores: (igdbId, name) => ipcRenderer.invoke(IPC.trendingStores, igdbId, name),
    open: (gameId, launcher) => ipcRenderer.invoke(IPC.trendingOpen, gameId, launcher),
    follow: (gameId, on) => ipcRenderer.invoke(IPC.trendingFollow, gameId, on)
  },
  stats: {
    get: () => ipcRenderer.invoke(IPC.statsGet)
  },
  progress: {
    get: () => ipcRenderer.invoke(IPC.progressGet),
    onChange: (callback) => {
      const listener = (_: Electron.IpcRendererEvent, p: Progress): void => callback(p)
      ipcRenderer.on(IPC.progressChanged, listener)
      return () => ipcRenderer.removeListener(IPC.progressChanged, listener)
    },
    syncNow: () => ipcRenderer.invoke(IPC.progressSyncNow)
  },
  downloads: {
    list: () => ipcRenderer.invoke(IPC.downloadsList),
    onChange: (callback) => {
      const listener = (_: Electron.IpcRendererEvent, items: DownloadItem[]): void => callback(items)
      ipcRenderer.on(IPC.downloadsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.downloadsChanged, listener)
    },
    plan: (gameId, installDir) => ipcRenderer.invoke(IPC.downloadsPlan, gameId, installDir),
    start: (gameId, installDir) => ipcRenderer.invoke(IPC.downloadsStart, gameId, installDir),
    pause: (id) => ipcRenderer.invoke(IPC.downloadsPause, id),
    resume: (id) => ipcRenderer.invoke(IPC.downloadsResume, id),
    cancel: (id) => ipcRenderer.invoke(IPC.downloadsCancel, id),
    clearFinished: () => ipcRenderer.invoke(IPC.downloadsClearFinished),
    showLog: () => ipcRenderer.invoke(IPC.downloadsShowLog)
  },
  stores: {
    state: () => ipcRenderer.invoke(IPC.storesState),
    onChange: (callback) => {
      const listener = (_: Electron.IpcRendererEvent, s: StoreAccounts): void => callback(s)
      ipcRenderer.on(IPC.storesChanged, listener)
      return () => ipcRenderer.removeListener(IPC.storesChanged, listener)
    },
    refresh: () => ipcRenderer.invoke(IPC.storesRefresh),
    epicLogin: () => ipcRenderer.invoke(IPC.storesEpicLogin),
    epicLoginWithCode: (code) => ipcRenderer.invoke(IPC.storesEpicLoginWithCode, code),
    epicLogout: () => ipcRenderer.invoke(IPC.storesEpicLogout),
    gogLogin: () => ipcRenderer.invoke(IPC.storesGogLogin),
    gogLogout: () => ipcRenderer.invoke(IPC.storesGogLogout)
  },
  steam: {
    state: () => ipcRenderer.invoke(IPC.steamState),
    onChange: (callback) => {
      const listener = (_: Electron.IpcRendererEvent, s: SteamState): void => callback(s)
      ipcRenderer.on(IPC.steamChanged, listener)
      return () => ipcRenderer.removeListener(IPC.steamChanged, listener)
    },
    link: (input) => ipcRenderer.invoke(IPC.steamLink, input),
    signIn: () => ipcRenderer.invoke(IPC.steamSignIn),
    cancelSignIn: () => ipcRenderer.invoke(IPC.steamCancelSignIn),
    unlink: () => ipcRenderer.invoke(IPC.steamUnlink),
    refresh: () => ipcRenderer.invoke(IPC.steamRefresh),
    ownedGames: () => ipcRenderer.invoke(IPC.steamOwnedGames),
    recentGames: () => ipcRenderer.invoke(IPC.steamRecentGames),
    achievements: (appId) => ipcRenderer.invoke(IPC.steamAchievements, appId)
  },
  voice: {
    serverUrl: () => ipcRenderer.invoke(IPC.voiceServerUrl),
    token: () => ipcRenderer.invoke(IPC.voiceToken),
    onPushToTalk(callback) {
      const listener = (_: Electron.IpcRendererEvent, down: boolean): void => callback(down)
      ipcRenderer.on(IPC.voicePushToTalk, listener)
      return () => ipcRenderer.removeListener(IPC.voicePushToTalk, listener)
    },
    hotkeyStatus: () => ipcRenderer.invoke(IPC.voiceHotkeyStatus)
  },
  account: {
    state: () => ipcRenderer.invoke(IPC.accountState),
    onChange(callback) {
      const listener = (_: Electron.IpcRendererEvent, s: AccountState): void => callback(s)
      ipcRenderer.on(IPC.accountChanged, listener)
      return () => ipcRenderer.removeListener(IPC.accountChanged, listener)
    },
    signUp: (email, username, password, remember) => ipcRenderer.invoke(IPC.accountSignUp, email, username, password, remember),
    signIn: (email, password, remember) => ipcRenderer.invoke(IPC.accountSignIn, email, password, remember),
    signOut: () => ipcRenderer.invoke(IPC.accountSignOut),
    availability: (input) => ipcRenderer.invoke(IPC.accountAvailability, input),
    setUsername: (username) => ipcRenderer.invoke(IPC.accountSetUsername, username),
    setProfile: (patch) => ipcRenderer.invoke(IPC.accountSetProfile, patch),
    sendResetCode: (email) => ipcRenderer.invoke(IPC.accountSendResetCode, email),
    resetPassword: (email, code, password) => ipcRenderer.invoke(IPC.accountResetPassword, email, code, password),
    deleteAccount: () => ipcRenderer.invoke(IPC.accountDelete)
  },
  friends: {
    list: () => ipcRenderer.invoke(IPC.friendsList),
    add: (username) => ipcRenderer.invoke(IPC.friendsAdd, username),
    accept: (id) => ipcRenderer.invoke(IPC.friendsAccept, id),
    decline: (id) => ipcRenderer.invoke(IPC.friendsDecline, id),
    remove: (id) => ipcRenderer.invoke(IPC.friendsRemove, id),
    stats: (id) => ipcRenderer.invoke(IPC.friendsStats, id),
    messages: (id, opts) => ipcRenderer.invoke(IPC.friendsMessages, id, opts),
    send: (id, text) => ipcRenderer.invoke(IPC.friendsSend, id, text),
    forGame: (gameId) => ipcRenderer.invoke(IPC.friendsForGame, gameId)
  },
  live: {
    game: (id) => ipcRenderer.invoke(IPC.liveGame, id),
    library: () => ipcRenderer.invoke(IPC.liveLibrary),
    openWorkshop: (id) => ipcRenderer.invoke(IPC.liveOpenWorkshop, id)
  },
  music: {
    state: () => ipcRenderer.invoke(IPC.musicState),
    pickFolder: () => ipcRenderer.invoke(IPC.musicPickFolder),
    track: (index) => ipcRenderer.invoke(IPC.musicTrack, index),
    url: (index, version) => `vanity-music://track/${index}?v=${version}`,
    artUrl: (index, version) => `vanity-music://art/${index}?v=${version}`
  },
  status: {
    get: () => ipcRenderer.invoke(IPC.statusGet),
    refresh: () => ipcRenderer.invoke(IPC.statusRefresh),
    onUpdate(callback) {
      const listener = (_: Electron.IpcRendererEvent, s: LauncherStatus[]): void => callback(s)
      ipcRenderer.on(IPC.statusUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.statusUpdated, listener)
    }
  },
  window: {
    setFullScreen: (on) => ipcRenderer.invoke(IPC.windowFullScreen, on)
  },
  discord: {
    status: () => ipcRenderer.invoke(IPC.discordStatus),
    onStatus(callback) {
      const listener = (_: Electron.IpcRendererEvent, s: DiscordStatus): void => callback(s)
      ipcRenderer.on(IPC.discordStatusChanged, listener)
      return () => ipcRenderer.removeListener(IPC.discordStatusChanged, listener)
    },
    setListening: (now) => ipcRenderer.send(IPC.discordListening, now)
  },
  update: {
    state: () => ipcRenderer.invoke(IPC.updateState),
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    apply: () => ipcRenderer.invoke(IPC.updateApply),
    onChange(callback) {
      const listener = (_: Electron.IpcRendererEvent, s: UpdateState): void => callback(s)
      ipcRenderer.on(IPC.updateChanged, listener)
      return () => ipcRenderer.removeListener(IPC.updateChanged, listener)
    }
  },
  scan: {
    start: () => ipcRenderer.invoke(IPC.scanStart),
    onProgress(callback) {
      const listener = (_: Electron.IpcRendererEvent, p: ScanProgress[]): void => callback(p)
      ipcRenderer.on(IPC.scanProgress, listener)
      return () => ipcRenderer.removeListener(IPC.scanProgress, listener)
    }
  },
  settings: {
    onChange: (callback) => {
      const listener = (_: Electron.IpcRendererEvent, s: Settings): void => callback(s)
      ipcRenderer.on(IPC.settingsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.settingsChanged, listener)
    },
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    pickFolder: () => ipcRenderer.invoke(IPC.settingsPickFolder)
  }
}

contextBridge.exposeInMainWorld('vanity', api)
