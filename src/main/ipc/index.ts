import { dirname } from 'node:path'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { DetectedGame, GameCandidate, GamePatch, ScanSummary, Settings } from '@shared/types'
import { runScan } from '../library/scan'
import type { LibraryStore } from '../library/store'
import { exeExternalId } from '../scanners/custom'
import { getSettings, updateSettings } from '../settings'
import { nameFromExecutable } from '../util/executables'

export function registerIpc(store: LibraryStore): void {
  let scanInFlight: Promise<ScanSummary> | null = null

  const windowOf = (e: IpcMainInvokeEvent): BrowserWindow | undefined =>
    BrowserWindow.fromWebContents(e.sender) ?? undefined

  ipcMain.handle(IPC.gamesList, () => store.list())
  ipcMain.handle(IPC.gamesGet, (_e, id: number) => store.get(id))
  ipcMain.handle(IPC.gamesUpdate, (_e, id: number, patch: GamePatch) => store.update(id, patch))
  ipcMain.handle(IPC.gamesRemove, (_e, id: number) => store.remove(id))

  ipcMain.handle(IPC.scanStart, (e) => {
    // A second click while scanning joins the running scan instead of starting another.
    scanInFlight ??= runScan({
      settings: getSettings(),
      store,
      onProgress: (p) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.scanProgress, p)
      }
    }).finally(() => {
      scanInFlight = null
    })
    return scanInFlight
  })

  ipcMain.handle(IPC.gamesConfirmCandidates, async (_e, accepted: GameCandidate[], rejected: GameCandidate[]) => {
    const toAdd: DetectedGame[] = accepted.map((c) => ({
      source: 'custom',
      externalId: exeExternalId(c.executablePath!),
      name: c.name.trim() || nameFromExecutable(c.executablePath!),
      installPath: c.installPath,
      executablePath: c.executablePath
    }))
    if (rejected.length) {
      const ignored = new Set(getSettings().ignoredExecutables)
      for (const c of rejected) if (c.executablePath) ignored.add(c.executablePath)
      await updateSettings({ ignoredExecutables: [...ignored] })
    }
    return store.upsert(toAdd).games
  })

  ipcMain.handle(IPC.gamesAddManually, async (e) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a game executable',
      properties: ['openFile'],
      filters: [{ name: 'Programs', extensions: ['exe'] }]
    }
    const win = windowOf(e)
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const exe = result.filePaths[0]
    if (result.canceled || !exe) return null
    const [game] = store.upsert([
      {
        source: 'manual',
        externalId: exeExternalId(exe),
        name: nameFromExecutable(exe),
        installPath: dirname(exe),
        executablePath: exe
      }
    ]).games
    return game
  })

  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: Partial<Settings>) => updateSettings(patch))

  ipcMain.handle(IPC.settingsPickFolder, async (e) => {
    const options: Electron.OpenDialogOptions = { title: 'Choose a games folder', properties: ['openDirectory'] }
    const win = windowOf(e)
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}
