import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type VanityApi } from '@shared/ipc'
import type { MetadataProgress, ScanProgress, SessionChange, TrendingState } from '@shared/types'

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
    addManually: () => ipcRenderer.invoke(IPC.gamesAddManually)
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
    open: (gameId, launcher) => ipcRenderer.invoke(IPC.trendingOpen, gameId, launcher)
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
