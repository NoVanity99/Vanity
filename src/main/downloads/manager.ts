import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { DownloadItem, DownloadStore, Game, InstallPlan } from '@shared/types'
import type { Kv } from '../db/kv'

const ITEMS_KEY = 'downloads:items'
const DIR_KEY = 'downloads:install-dir'
/** Some room is kept free on top of what the game needs. */
const SPACE_MARGIN = 512 * 1024 * 1024
/** How often progress is passed on to the screen while a download runs. */
const EMIT_EVERY_MS = 500

/** A failure with a message that can be shown as-is. */
export class DownloadError extends Error {}

export interface RunningDownload {
  /** Resolves when the game is installed. Rejects with a message to show (anything, if stopped). */
  done: Promise<void>
  /** Stops it, keeping what has been downloaded so far. */
  stop(): Promise<void>
}

/** One store's way of installing a game. */
export interface DownloadDriver {
  readonly store: DownloadStore
  /** Sizes, before anything is downloaded. */
  sizes(game: Game): Promise<{ downloadBytes: number; installBytes: number }>
  run(game: Game, installDir: string, report: (patch: Partial<DownloadItem>) => void, log: (line: string) => void): RunningDownload
  /** Removes what a cancelled download left behind. */
  cleanup(game: Game, installDir: string): Promise<void>
}

export interface DownloadManagerDeps {
  kv: Kv
  drivers: DownloadDriver[]
  getGame(id: number): Game | null
  /** Used when the user hasn't picked a folder yet. */
  defaultDir: string
  /** Free bytes on the drive that holds `path`, or null if it can't be read. */
  freeSpace(path: string): Promise<number | null>
  /** A game finished installing: look for it and tell the screens. */
  onInstalled(game: Game): Promise<void> | void
  onChange(items: DownloadItem[]): void
  /** Lines from the store's downloader, for troubleshooting. */
  log?(itemId: string, line: string): void
  now?: () => number
}

/** Free space on the drive holding `path`, looking at the nearest folder that exists. */
export async function freeSpaceOn(path: string): Promise<number | null> {
  let dir = path
  for (let i = 0; i < 50; i++) {
    try {
      const s = await fs.statfs(dir)
      return Number(s.bavail) * Number(s.bsize)
    } catch {
      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }
  return null
}

/**
 * The download queue: one game at a time, in the order they were added, with pause, resume
 * and cancel. The queue is remembered between launches (downloads continue where they stopped).
 */
export class DownloadManager {
  private items: DownloadItem[]
  private active: { id: string; run: RunningDownload; intent: 'run' | 'pause' | 'cancel' } | null = null
  private lastEmit = 0
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private pumping = false
  private closing = false

  constructor(private deps: DownloadManagerDeps) {
    const saved = deps.kv.get<DownloadItem[]>(ITEMS_KEY) ?? []
    // Whatever was running when Vanity closed is paused: nothing downloads until you say so.
    this.items = saved.map((i) => (i.state === 'downloading' || i.state === 'preparing' || i.state === 'installing' ? { ...i, state: 'paused', speedBps: 0, etaSeconds: null } : i))
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  list(): DownloadItem[] {
    return this.items.map((i) => ({ ...i }))
  }

  private driver(store: string): DownloadDriver | undefined {
    return this.deps.drivers.find((d) => d.store === store)
  }

  /** Whether Vanity can install this game by itself (Epic and GOG games that aren't installed). */
  canInstall(game: Game): boolean {
    return !game.installed && !!this.driver(game.source)
  }

  installDir(): string {
    return this.deps.kv.get<string>(DIR_KEY) || this.deps.defaultDir
  }

  private save(): void {
    this.deps.kv.set(ITEMS_KEY, this.items)
  }

  /** Tells the screens. Progress updates are spaced out; state changes go at once. */
  private emit(now = false): void {
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = null
    const wait = now ? 0 : this.lastEmit + EMIT_EVERY_MS - this.now()
    if (wait <= 0) {
      this.lastEmit = this.now()
      this.deps.onChange(this.list())
      return
    }
    this.emitTimer = setTimeout(() => this.emit(true), wait)
  }

  private patch(id: string, patch: Partial<DownloadItem>, now = false): void {
    const i = this.items.findIndex((x) => x.id === id)
    if (i < 0) return
    this.items[i] = { ...this.items[i], ...patch }
    if (now) this.save()
    this.emit(now)
  }

  /** What installing `game` into `installDir` would take, and whether there is room. */
  async plan(gameId: number, installDir?: string): Promise<InstallPlan> {
    const game = this.deps.getGame(gameId)
    if (!game) throw new DownloadError('This game is no longer in your library.')
    const driver = this.driver(game.source)
    if (!driver || game.installed) throw new DownloadError(`Vanity can't install ${game.name} by itself.`)
    const dir = (installDir || this.installDir()).trim()
    const { downloadBytes, installBytes } = await driver.sizes(game)
    const freeBytes = await this.deps.freeSpace(dir)
    // When a store doesn't say how big the installed game is, assume about what it downloads, twice
    // (the installer and the game it unpacks are both on disk for a while).
    const needed = (installBytes || downloadBytes * 2) + SPACE_MARGIN
    return { store: driver.store, downloadBytes, installBytes, installDir: dir, freeBytes, enoughSpace: freeBytes === null || freeBytes >= needed }
  }

  /** Adds a game to the queue. Rejects, with a message, when there clearly isn't room. */
  async enqueue(gameId: number, installDir: string): Promise<DownloadItem> {
    const game = this.deps.getGame(gameId)
    if (!game) throw new DownloadError('This game is no longer in your library.')
    const existing = this.items.find((i) => i.gameId === gameId && i.state !== 'done')
    if (existing) {
      if (existing.state === 'paused' || existing.state === 'failed') await this.resume(existing.id)
      return existing
    }
    const dir = installDir.trim()
    if (!dir) throw new DownloadError('Choose a folder to install into.')
    const plan = await this.plan(gameId, dir)
    if (!plan.enoughSpace) throw new DownloadError("There isn't enough free space on that drive. Free some up, or choose another folder.")
    this.deps.kv.set(DIR_KEY, dir)
    const item: DownloadItem = {
      id: `${plan.store}-${gameId}-${this.now().toString(36)}`,
      gameId,
      name: game.name,
      store: plan.store,
      state: 'queued',
      percent: 0,
      downloadedBytes: 0,
      totalBytes: plan.downloadBytes,
      speedBps: 0,
      etaSeconds: null,
      installDir: dir,
      error: null,
      addedAt: this.now(),
      coverPath: game.coverPath
    }
    this.items = [...this.items.filter((i) => i.gameId !== gameId), item]
    this.save()
    this.emit(true)
    void this.pump()
    return item
  }

  async pause(id: string): Promise<void> {
    if (this.active?.id === id) {
      this.active.intent = 'pause'
      await this.active.run.stop()
      return
    }
    const item = this.items.find((i) => i.id === id)
    if (item?.state === 'queued') this.patch(id, { state: 'paused' }, true)
  }

  async resume(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id)
    if (!item || (item.state !== 'paused' && item.state !== 'failed')) return
    this.patch(id, { state: 'queued', error: null }, true)
    void this.pump()
  }

  /** Stops and removes a download, deleting what it had fetched. */
  async cancel(id: string): Promise<void> {
    const item = this.items.find((i) => i.id === id)
    if (!item) return
    if (this.active?.id === id) {
      this.active.intent = 'cancel'
      await this.active.run.stop()
      // run() finishes the removal once the downloader has let go of its files.
      return
    }
    await this.discard(item)
  }

  private async discard(item: DownloadItem): Promise<void> {
    this.items = this.items.filter((i) => i.id !== item.id)
    this.save()
    this.emit(true)
    const game = this.deps.getGame(item.gameId)
    const driver = this.driver(item.store)
    if (game && driver && item.state !== 'done') await driver.cleanup(game, item.installDir).catch((err) => console.warn('[downloads] cleanup failed:', err))
  }

  /** Takes finished downloads out of the list. */
  clearFinished(): void {
    this.items = this.items.filter((i) => i.state !== 'done')
    this.save()
    this.emit(true)
  }

  /** Stops whatever is running (Vanity is closing); it is paused next time. */
  async shutdown(): Promise<void> {
    this.closing = true
    if (this.emitTimer) clearTimeout(this.emitTimer)
    if (!this.active) return
    this.active.intent = 'pause'
    await this.active.run.stop().catch(() => {})
  }

  /** Starts the next queued download when nothing is running. */
  private async pump(): Promise<void> {
    if (this.pumping || this.active) return
    this.pumping = true
    try {
      for (;;) {
        const next = this.closing ? undefined : this.items.find((i) => i.state === 'queued')
        if (!next) return
        await this.runOne(next)
      }
    } finally {
      this.pumping = false
    }
  }

  private async runOne(item: DownloadItem): Promise<void> {
    const game = this.deps.getGame(item.gameId)
    const driver = this.driver(item.store)
    if (!game || !driver) {
      this.patch(item.id, { state: 'failed', error: 'This game is no longer in your library.' }, true)
      return
    }
    if (game.installed) {
      this.patch(item.id, { state: 'done', percent: 100, speedBps: 0, etaSeconds: null }, true)
      return
    }
    this.patch(item.id, { state: 'preparing', error: null, speedBps: 0, etaSeconds: null }, true)
    const log = (line: string): void => this.deps.log?.(item.id, line)
    let run: RunningDownload
    try {
      const free = await this.deps.freeSpace(item.installDir)
      if (free !== null && free < SPACE_MARGIN) throw new DownloadError("There isn't enough free space on that drive.")
      run = driver.run(
        game,
        item.installDir,
        (patch) => {
          // The first progress report means the download is really under way.
          const current = this.items.find((i) => i.id === item.id)
          const state = patch.state ?? (current?.state === 'preparing' ? 'downloading' : current?.state)
          this.patch(item.id, { ...patch, ...(state ? { state } : {}) })
        },
        log
      )
    } catch (err) {
      this.patch(item.id, { state: 'failed', error: err instanceof Error ? err.message : 'The download could not start.' }, true)
      return
    }
    this.active = { id: item.id, run, intent: 'run' }
    try {
      await run.done
      this.active = null
      this.patch(item.id, { state: 'done', percent: 100, speedBps: 0, etaSeconds: null, error: null }, true)
      await Promise.resolve(this.deps.onInstalled(game)).catch((err) => console.warn('[downloads] could not refresh the library:', err))
    } catch (err) {
      const intent = this.active?.intent ?? 'run'
      this.active = null
      if (intent === 'cancel') {
        const current = this.items.find((i) => i.id === item.id)
        if (current) await this.discard(current)
      } else if (intent === 'pause') {
        this.patch(item.id, { state: 'paused', speedBps: 0, etaSeconds: null }, true)
      } else {
        const message = err instanceof Error && err.message ? err.message : 'The download failed.'
        log(`FAILED: ${message}`)
        this.patch(item.id, { state: 'failed', speedBps: 0, etaSeconds: null, error: message }, true)
      }
    }
  }
}
