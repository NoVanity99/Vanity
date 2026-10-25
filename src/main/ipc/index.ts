import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC, type Result } from '@shared/ipc'
import type { NowListening, ArtworkKind, DetectedGame, GameCandidate, GamePatch, MatchCandidate, ScanSummary, Settings, StoreLauncher } from '@shared/types'
import type { TrendingService } from '../trending/service'
import type { StatusService } from '../status/service'
import type { MusicLibrary } from '../music/library'
import type { LiveService } from '../live/service'
import type { DetailsService } from '../details/service'
import type { Updater } from '../update/release'
import type { DiscordPresence } from '../discord/presence'
import { gamePlayStats } from '../library/stats'
import type { Db } from '../db/database'
import type { AccountService } from '../account/service'
import { gameKey } from '../account/gameKey'
import type { MediaCache } from '../metadata/mediaCache'
import type { MetadataService } from '../metadata/service'
import { launchGame, LaunchError } from '../launcher/launch'
import type { SessionTracker } from '../launcher/tracker'
import { runScan } from '../library/scan'
import type { LibraryStore } from '../library/store'
import type { CollectionsStore } from '../library/collections'
import { exeExternalId } from '../scanners/custom'
import { getSettings, updateSettings } from '../settings'
import { nameFromExecutable } from '../util/executables'
import { isDirectory, pathExists } from '../util/fs'

/** Runs a handler and turns any failure into a message the UI can show. */
async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { data: await fn() }
  } catch (err) {
    console.warn('[ipc]', err)
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

const KINDS = new Set<ArtworkKind>(['cover', 'hero', 'logo', 'icon'])
const validKind = (kind: ArtworkKind): ArtworkKind => {
  if (!KINDS.has(kind)) throw new Error(`Unknown artwork kind: ${kind}`)
  return kind
}

export interface IpcDeps {
  store: LibraryStore
  collections: CollectionsStore
  tracker: SessionTracker
  metadata: MetadataService
  media: MediaCache
  trending: TrendingService
  status: StatusService
  music: MusicLibrary
  live: LiveService
  details: DetailsService
  update: Updater
  discord: DiscordPresence
  db: Db
  stats: () => unknown
  account: AccountService
  /** Called after settings change (e.g. to recolour the window for a new theme). */
  onSettingsChanged?: (settings: Settings) => void
}

export function registerIpc({ store, collections, tracker, metadata, media, trending, status, music, live, details, update, discord, db, stats, account, onSettingsChanged }: IpcDeps): void {
  let scanInFlight: Promise<ScanSummary> | null = null

  const windowOf = (e: IpcMainInvokeEvent): BrowserWindow | undefined =>
    BrowserWindow.fromWebContents(e.sender) ?? undefined

  ipcMain.handle(IPC.gamesList, () => store.list())
  ipcMain.handle(IPC.gamesGet, (_e, id: number) => store.get(id))
  ipcMain.handle(IPC.gamesUpdate, (_e, id: number, patch: GamePatch) => store.update(id, patch))
  ipcMain.handle(IPC.gamesRemove, async (_e, id: number) => {
    store.remove(id)
    await media.removeGame(id)
  })

  ipcMain.handle(IPC.gamesLaunch, async (_e, id: number) => {
    const game = store.get(id)
    if (!game) return 'This game is no longer in your library.'
    try {
      const result = await launchGame(game, {
        openExternal: (url) => shell.openExternal(url),
        openPath: (p) => shell.openPath(p),
        spawn,
        exists: pathExists
      })
      tracker.begin(game, result.method, result.child)
      return null
    } catch (err) {
      if (err instanceof LaunchError) return err.message
      console.error('[launch] unexpected error:', err)
      return `Couldn't start ${game.name}.`
    }
  })

  ipcMain.handle(IPC.gamesPickExecutable, async (e, id: number) => {
    const game = store.get(id)
    if (!game) return null
    const options: Electron.OpenDialogOptions = {
      title: `Choose the program that starts ${game.name}`,
      defaultPath: game.installPath ?? undefined,
      properties: ['openFile'],
      filters: [{ name: 'Programs', extensions: ['exe'] }]
    }
    const win = windowOf(e)
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const exe = result.filePaths[0]
    if (result.canceled || !exe) return null
    return store.update(id, { executablePath: exe })
  })

  ipcMain.handle(IPC.gamesPlayStats, (_e, id: number) => gamePlayStats(db, Number(id)))
  ipcMain.handle(IPC.gamesDetails, (_e, id: number, refresh: boolean) => details.forGame(Number(id), refresh === true).catch(() => null))
  ipcMain.handle(IPC.gamesDiskSize, (_e, id: number) => details.diskSize(Number(id)).catch(() => null))

  ipcMain.handle(IPC.collectionsList, () => collections.list())
  ipcMain.handle(IPC.collectionsCreate, (_e, name: string) => wrap(async () => collections.create(name)))
  ipcMain.handle(IPC.collectionsRename, (_e, id: number, name: string) => wrap(async () => collections.rename(Number(id), name)))
  ipcMain.handle(IPC.collectionsRemove, (_e, id: number) => collections.remove(Number(id)))
  ipcMain.handle(IPC.collectionsSetMember, (_e, collectionId: number, gameId: number, member: boolean) =>
    wrap(async () => {
      collections.setMember(Number(collectionId), Number(gameId), member === true)
      return store.get(Number(gameId))
    })
  )

  ipcMain.handle(IPC.sessionsStates, () => tracker.states())

  ipcMain.handle(IPC.gamesOpenFolder, async (_e, id: number) => {
    const game = store.get(id)
    const folder = game?.installPath ?? (game?.executablePath ? dirname(game.executablePath) : null)
    if (!folder) return 'This game has no install folder.'
    if (!(await isDirectory(folder))) return `Folder not found: ${folder}`
    const error = await shell.openPath(folder)
    return error || null
  })

  ipcMain.handle(IPC.scanStart, (e) => {
    // A second click while scanning joins the running scan instead of starting another.
    scanInFlight ??= runScan({
      settings: getSettings(),
      store,
      onProgress: (p) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.scanProgress, p)
      }
    })
      .then((summary) => {
        // Fetch artwork and details for anything new.
        metadata.enqueuePending()
        return summary
      })
      .finally(() => {
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
    const added = store.upsert(toAdd).games
    metadata.enqueue(added.map((g) => g.id))
    return added
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
    if (game) metadata.enqueue([game.id])
    return game
  })

  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsUpdate, async (_e, patch: Partial<Settings>) => {
    const before = getSettings()
    const after = await updateSettings(patch)
    const keysChanged =
      before.steamGridDbApiKey !== after.steamGridDbApiKey ||
      before.igdbClientId !== after.igdbClientId ||
      before.igdbClientSecret !== after.igdbClientSecret
    if (keysChanged) {
      metadata.onKeysChanged()
      void trending.refresh()
    }
    if (before.githubToken !== after.githubToken || before.updateKey !== after.updateKey || before.accountServerUrl !== after.accountServerUrl) void update.check()
    if (before.discordPresence !== after.discordPresence || before.discordClientId !== after.discordClientId) discord.sync()
    onSettingsChanged?.(after)
    return after
  })

  ipcMain.handle(IPC.metadataProgress, () => metadata.progress())
  ipcMain.handle(IPC.metadataRefresh, (_e, id: number) => wrap(async () => {
    await metadata.process(id, true)
    return store.get(id)
  }))
  ipcMain.handle(IPC.metadataRefreshAll, () => metadata.refreshAll())
  ipcMain.handle(IPC.metadataSearch, (_e, query: string) => wrap(() => metadata.search(String(query))))
  ipcMain.handle(IPC.metadataApplyMatch, (_e, id: number, candidate: MatchCandidate) =>
    wrap(() => metadata.applyMatch(id, candidate))
  )
  ipcMain.handle(IPC.metadataArtworkOptions, (_e, id: number, kind: ArtworkKind) =>
    wrap(() => metadata.artworkOptions(id, validKind(kind)))
  )
  ipcMain.handle(IPC.metadataSetArtwork, (_e, id: number, kind: ArtworkKind, url: string) =>
    wrap(async () => {
      // Only accept https artwork URLs (they come from SteamGridDB results).
      if (!/^https:\/\//i.test(url)) throw new Error('Invalid image address.')
      return metadata.setArtworkFromUrl(id, validKind(kind), url)
    })
  )
  ipcMain.handle(IPC.metadataSetArtworkFromFile, (e, id: number, kind: ArtworkKind) =>
    wrap(async () => {
      const options: Electron.OpenDialogOptions = {
        title: 'Choose an image',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'ico', 'bmp'] }]
      }
      const win = windowOf(e)
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      const file = result.filePaths[0]
      if (result.canceled || !file) return null
      return metadata.setArtworkFromFile(id, validKind(kind), file)
    })
  )
  ipcMain.handle(IPC.metadataResetArtwork, (_e, id: number, kind: ArtworkKind) =>
    wrap(() => metadata.resetArtwork(id, validKind(kind)))
  )
  ipcMain.handle(IPC.metadataCheckKeys, () => metadata.checkKeys())

  ipcMain.handle(IPC.statsGet, () => stats())

  const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')
  ipcMain.handle(IPC.accountState, () => account.state())
  ipcMain.handle(IPC.accountSetServer, (_e, url: string) => wrap(() => account.setServer(text(url, 500))))
  ipcMain.handle(IPC.accountRegister, (_e, u: string, p: string) => wrap(() => account.register(text(u), text(p))))
  ipcMain.handle(IPC.accountLogin, (_e, u: string, p: string) => wrap(() => account.login(text(u), text(p))))
  ipcMain.handle(IPC.accountLogout, () => account.logout())
  ipcMain.handle(IPC.accountDelete, () => wrap(() => account.deleteAccount()))
  ipcMain.handle(IPC.friendsList, () => wrap(() => account.guard((c) => c.friends())))
  ipcMain.handle(IPC.friendsAdd, (_e, u: string) => wrap(async () => (await account.guard((c) => c.addFriend(text(u)))).status))
  ipcMain.handle(IPC.friendsAccept, (_e, id: string) => wrap(async () => (await account.guard((c) => c.accept(text(id))), true as const)))
  ipcMain.handle(IPC.friendsDecline, (_e, id: string) => wrap(async () => (await account.guard((c) => c.decline(text(id))), true as const)))
  ipcMain.handle(IPC.friendsRemove, (_e, id: string) => wrap(async () => (await account.guard((c) => c.removeFriend(text(id))), true as const)))
  ipcMain.handle(IPC.friendsStats, (_e, id: string) => wrap(() => account.guard((c) => c.friendStats(text(id)))))
  ipcMain.handle(IPC.friendsForGame, (_e, gameId: number) =>
    wrap(async () => {
      const game = store.get(Number(gameId))
      if (!game) return []
      return account.guard((c) => c.gameFriends(gameKey(game.name)))
    })
  )
  ipcMain.handle(IPC.liveGame, (_e, id: number) => live.forGame(Number(id)).catch(() => null))
  ipcMain.handle(IPC.liveLibrary, () => live.libraryPlayers().catch(() => ({})))
  ipcMain.handle(IPC.liveOpenWorkshop, (_e, id: number) =>
    wrap(async () => {
      const game = store.get(Number(id))
      if (!game || game.source !== 'steam' || !/^\d+$/.test(game.externalId)) throw new Error('Only Steam games have a Workshop.')
      await shell.openExternal(`steam://url/SteamWorkshopPage/${game.externalId}`)
      return true as const
    })
  )

  ipcMain.handle(IPC.musicState, () => music.state())
  ipcMain.handle(IPC.musicTrack, (_e, index: number) => music.trackInfo(Number(index)).catch(() => null))
  ipcMain.handle(IPC.musicPickFolder, async (e) => {
    const options: Electron.OpenDialogOptions = { title: 'Choose your music folder', properties: ['openDirectory'] }
    const win = windowOf(e)
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const folder = result.filePaths[0]
    if (result.canceled || !folder) return null
    await updateSettings({ musicFolder: folder })
    await music.load(folder)
    return music.state()
  })

  ipcMain.handle(IPC.windowFullScreen, (e, on: boolean) => windowOf(e)?.setFullScreen(on === true))
  ipcMain.handle(IPC.discordStatus, () => discord.getStatus())
  ipcMain.on(IPC.discordListening, (_e, now: NowListening | null) => {
    const ok = now && typeof now.title === 'string' && Number.isFinite(now.startedAt)
    discord.setMusic(
      ok
        ? {
            title: now.title.slice(0, 200),
            artist: typeof now.artist === 'string' ? now.artist.slice(0, 200) : null,
            startedAt: now.startedAt,
            durationMs: typeof now.durationMs === 'number' && now.durationMs > 0 ? now.durationMs : null
          }
        : null
    )
  })

  ipcMain.handle(IPC.updateState, () => update.state())
  ipcMain.handle(IPC.updateCheck, () => update.check())
  ipcMain.handle(IPC.updateApply, () => wrap(async () => (await update.apply(), true as const)))

  ipcMain.handle(IPC.statusGet, () => status.get())
  ipcMain.handle(IPC.statusRefresh, async () => {
    await status.check()
    return status.get()
  })

  ipcMain.handle(IPC.trendingGet, () => trending.get())
  ipcMain.handle(IPC.trendingRefresh, async () => {
    await trending.refresh()
    return trending.state()
  })
  ipcMain.handle(IPC.trendingFollow, (_e, gameId: number, on: boolean) => trending.follow(Number(gameId), on === true))
  ipcMain.handle(IPC.trendingInstalled, () => trending.installed())
  ipcMain.handle(IPC.trendingOpen, (_e, gameId: number, launcher: StoreLauncher) =>
    wrap(() => trending.open(Number(gameId), launcher))
  )

  ipcMain.handle(IPC.settingsPickFolder, async (e) => {
    const options: Electron.OpenDialogOptions = { title: 'Choose a games folder', properties: ['openDirectory'] }
    const win = windowOf(e)
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}
