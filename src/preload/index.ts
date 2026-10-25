import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type VanityApi } from '@shared/ipc'
import type { AccountState, LauncherStatus, MetadataProgress, ScanProgress, SessionChange, TrendingState, UpdateState, DiscordStatus } from '@shared/types'

const api: VanityApi = {
  games: {
    list: () => ipcRenderer.invoke(IPC.gamesList),
    get: (id) => ipcRenderer.invoke(IPC.gamesGet, id),
    update: (id, patch) => ipcRenderer.invoke(IPC.gamesUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.gamesRemove, id),
    openFolder: (id) => ipcRenderer.invoke(IPC.gamesOpenFolder, id),
    launch: (id) => ipcRenderer.invoke(IPC.gamesLaunch, id),
    pickExecutable: (id) => ipcRenderer.invoke(IPC.gamesPickExecutable, id),
    confirmCandidates: (accepted, rejected) => ipcRenderer.invoke(IPC.gamesConfirmCandidates, accepted, rejected),
    addManually: () => ipcRenderer.invoke(IPC.gamesAddManually),
    playStats: (id) => ipcRenderer.invoke(IPC.gamesPlayStats, id),
    details: (id, refresh) => ipcRenderer.invoke(IPC.gamesDetails, id, refresh === true),
    diskSize: (id) => ipcRenderer.invoke(IPC.gamesDiskSize, id)
  },
  collections: {
    list: () => ipcRenderer.invoke(IPC.collectionsList),
    create: (name) => ipcRenderer.invoke(IPC.collectionsCreate, name),
    rename: (id, name) => ipcRenderer.invoke(IPC.collectionsRename, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.collectionsRemove, id),
    setMember: (collectionId, gameId, member) => ipcRenderer.invoke(IPC.collectionsSetMember, collectionId, gameId, member)
  },
  sessions: {
    states: () => ipcRenderer.invoke(IPC.sessionsStates),
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
    open: (gameId, launcher) => ipcRenderer.invoke(IPC.trendingOpen, gameId, launcher),
    follow: (gameId, on) => ipcRenderer.invoke(IPC.trendingFollow, gameId, on)
  },
  stats: {
    get: () => ipcRenderer.invoke(IPC.statsGet)
  },
  account: {
    state: () => ipcRenderer.invoke(IPC.accountState),
    onChange(callback) {
      const listener = (_: Electron.IpcRendererEvent, s: AccountState): void => callback(s)
      ipcRenderer.on(IPC.accountChanged, listener)
      return () => ipcRenderer.removeListener(IPC.accountChanged, listener)
    },
    setServer: (url) => ipcRenderer.invoke(IPC.accountSetServer, url),
    register: (u, p) => ipcRenderer.invoke(IPC.accountRegister, u, p),
    login: (u, p) => ipcRenderer.invoke(IPC.accountLogin, u, p),
    logout: () => ipcRenderer.invoke(IPC.accountLogout),
    deleteAccount: () => ipcRenderer.invoke(IPC.accountDelete)
  },
  friends: {
    list: () => ipcRenderer.invoke(IPC.friendsList),
    add: (username) => ipcRenderer.invoke(IPC.friendsAdd, username),
    accept: (id) => ipcRenderer.invoke(IPC.friendsAccept, id),
    decline: (id) => ipcRenderer.invoke(IPC.friendsDecline, id),
    remove: (id) => ipcRenderer.invoke(IPC.friendsRemove, id),
    stats: (id) => ipcRenderer.invoke(IPC.friendsStats, id),
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
    track: (index) => ipcRenderer.invoke(IPC.musicTrack, index)
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
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    pickFolder: () => ipcRenderer.invoke(IPC.settingsPickFolder)
  }
}

contextBridge.exposeInMainWorld('vanity', api)
