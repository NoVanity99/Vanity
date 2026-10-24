import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type VanityApi } from '@shared/ipc'
import type { ScanProgress, SessionChange } from '@shared/types'

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
