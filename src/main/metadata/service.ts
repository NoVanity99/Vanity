import type { ArtworkKind, ArtworkOption, Game, KeyCheck, MatchCandidate, MetadataProgress, Settings } from '@shared/types'
import type { LibraryStore } from '../library/store'
import { pathExists } from '../util/fs'
import { HttpError, NetworkError, type FetchFn } from './http'
import { Igdb, type IgdbDetails } from './igdb'
import { pickBestMatch } from './match'
import type { MediaCache } from './mediaCache'
import type { Details, MetadataRepo } from './repo'
import { SteamGridDb } from './steamgriddb'
import { steamArtworkUrl, SteamStore, type SteamDetails } from './steamStore'

const KINDS: ArtworkKind[] = ['cover', 'hero', 'logo', 'icon']
const CONCURRENCY = 2
const OFFLINE_RETRY_MS = 10 * 60_000

export interface MetadataDeps {
  store: LibraryStore
  repo: MetadataRepo
  media: MediaCache
  fetchFn: FetchFn
  getSettings(): Settings
  onProgress(p: MetadataProgress): void
  onGameUpdated(gameId: number): void
  now?: () => number
}

interface Providers {
  sgdb: SteamGridDb | null
  igdb: Igdb | null
  steam: SteamStore
}

function describe(err: unknown): string {
  if (err instanceof HttpError && err.status === 401) return 'API key was rejected. Check it in Settings.'
  return err instanceof Error ? err.message : String(err)
}

const pathKey: Record<ArtworkKind, 'coverPath' | 'heroPath' | 'logoPath' | 'iconPath'> = {
  cover: 'coverPath',
  hero: 'heroPath',
  logo: 'logoPath',
  icon: 'iconPath'
}

/**
 * Finds each game on SteamGridDB / IGDB (Steam games by app ID, others by
 * fuzzy name), downloads details and artwork into the local cache, and keeps
 * a background queue. Failures are recorded per game and never thrown out of
 * the queue, so a missing key or being offline can't crash the app.
 */
export class MetadataService {
  private cached: { key: string; providers: Providers } | null = null
  private queue = new Map<number, boolean>() // game ID → force refresh
  private active = 0
  private done = 0
  private total = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /** Games dropped from the queue while offline, retried with the next attempt. */
  private deferred = new Set<number>()
  private readonly now: () => number

  constructor(private deps: MetadataDeps) {
    this.now = deps.now ?? Date.now
  }

  private providers(): Providers {
    const s = this.deps.getSettings()
    const key = [s.steamGridDbApiKey, s.igdbClientId, s.igdbClientSecret].join('\n')
    if (this.cached?.key !== key) {
      this.cached = {
        key,
        providers: {
          sgdb: s.steamGridDbApiKey ? new SteamGridDb(s.steamGridDbApiKey, this.deps.fetchFn) : null,
          igdb: s.igdbClientId && s.igdbClientSecret ? new Igdb(s.igdbClientId, s.igdbClientSecret, this.deps.fetchFn) : null,
          steam: new SteamStore(this.deps.fetchFn)
        }
      }
    }
    return this.cached.providers
  }

  // ---- queue ---------------------------------------------------------------

  progress(): MetadataProgress {
    return { running: this.active > 0 || this.queue.size > 0, done: this.done, total: this.total }
  }

  enqueue(ids: number[], force = false): void {
    for (const id of ids) {
      if (!this.queue.has(id)) this.total++
      this.queue.set(id, force || (this.queue.get(id) ?? false))
    }
    this.emitProgress()
    this.pump()
  }

  /** Queues games never fetched or whose last attempt failed. */
  enqueuePending(): void {
    this.enqueue(this.deps.repo.pendingIds())
  }

  /** After API keys change, retry the games that keys could help with. */
  onKeysChanged(): void {
    this.enqueue(this.deps.repo.idsWithStatus(['no-keys', 'unmatched', 'error']))
  }

  refreshAll(): void {
    this.enqueue(this.deps.repo.allIds(), true)
  }

  private emitProgress(): void {
    const p = this.progress()
    this.deps.onProgress(p)
    if (!p.running) {
      this.done = 0
      this.total = 0
    }
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.size > 0) {
      const [id, force] = this.queue.entries().next().value as [number, boolean]
      this.queue.delete(id)
      this.active++
      this.process(id, force)
        .catch((err) => {
          if (err instanceof NetworkError) this.pauseForOffline()
          else console.error('[metadata] unexpected error for game', id, err)
        })
        .finally(() => {
          this.active--
          this.done++
          this.emitProgress()
          this.pump()
        })
    }
  }

  /** Offline: drop the rest of this run and try again later. */
  private pauseForOffline(): void {
    this.done += this.queue.size
    for (const id of this.queue.keys()) this.deferred.add(id)
    this.queue.clear()
    if (this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      const ids = [...this.deferred]
      this.deferred.clear()
      this.enqueue(ids)
      this.enqueuePending()
    }, OFFLINE_RETRY_MS)
  }

  dispose(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.queue.clear()
  }

  // ---- per-game work -------------------------------------------------------

  /**
   * Matches, fetches details and downloads artwork for one game.
   * Rethrows NetworkError (after recording it) so the queue can pause.
   */
  async process(id: number, force = false): Promise<void> {
    const game = this.deps.store.get(id)
    if (!game) return
    const p = this.providers()
    const steamId = game.source === 'steam' && /^\d+$/.test(game.externalId) ? game.externalId : null
    const { repo } = this.deps

    if (!p.sgdb && !p.igdb && !steamId) {
      repo.setStatus(id, 'no-keys', 'Add a SteamGridDB key or IGDB credentials in Settings to fetch artwork and details.', this.now())
      this.deps.onGameUpdated(id)
      return
    }

    const errors: string[] = []
    let offline: NetworkError | null = null
    const attempt = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      // Once offline, don't wait on more requests that will fail the same way.
      if (offline) return null
      try {
        return await fn()
      } catch (err) {
        if (err instanceof NetworkError) offline ??= err
        else errors.push(describe(err))
        return null
      }
    }

    // 1. Match
    let { steamGridDbId, igdbId } = game.metadata
    if (!game.metadata.matchLocked) {
      if (p.sgdb && (steamGridDbId === null || force)) {
        const sgdb = p.sgdb
        steamGridDbId =
          (steamId ? (await attempt(() => sgdb.gameBySteamAppId(steamId)))?.id : null) ??
          (await attempt(async () => pickBestMatch(game.name, await sgdb.search(game.name), (c) => c.name)?.id ?? null)) ??
          null
      }
      if (p.igdb && (igdbId === null || force)) {
        const igdb = p.igdb
        igdbId =
          (steamId ? await attempt(() => igdb.gameIdBySteamAppId(steamId)) : null) ??
          (await attempt(async () => pickBestMatch(game.name, await igdb.search(game.name), (c) => c.name)?.id ?? null)) ??
          null
      }
      repo.setMatch(id, { steamGridDbId, igdbId })
    }

    // 2. Details: IGDB first, gaps filled from the Steam store for Steam games.
    let steamDetails: SteamDetails | null = null
    if (!game.metadata.detailsLocked && (force || game.metadata.updatedAt === null || game.metadata.status !== 'matched')) {
      const igdb = p.igdb
      const fromIgdb: IgdbDetails | null = igdb && igdbId !== null ? await attempt(() => igdb.details(igdbId!)) : null
      const complete = fromIgdb?.summary && fromIgdb.genres.length && fromIgdb.releaseDate && fromIgdb.developer
      if (steamId && !complete) steamDetails = await attempt(() => p.steam.details(steamId))
      if (fromIgdb || steamDetails) {
        const details: Details = {
          description: fromIgdb?.summary ?? steamDetails?.description ?? null,
          genres: fromIgdb?.genres.length ? fromIgdb.genres : (steamDetails?.genres ?? []),
          releaseDate: fromIgdb?.releaseDate ?? steamDetails?.releaseDate ?? null,
          developer: fromIgdb?.developer ?? steamDetails?.developer ?? null
        }
        repo.setDetails(id, details)
      }
    }

    // 3. Artwork: SteamGridDB's top-rated image, else Steam's own.
    let gotArtwork = false
    for (const kind of KINDS) {
      if (game.metadata.lockedArtwork.includes(kind)) continue
      const current = game[pathKey[kind]]
      const abs = current && this.deps.media.resolve(current)
      if (!force && abs && (await pathExists(abs))) {
        gotArtwork = true
        continue
      }
      const urls: string[] = []
      const sgdb = p.sgdb
      if (sgdb && steamGridDbId !== null) {
        const options = await attempt(() => sgdb.artwork(kind, steamGridDbId!))
        if (options?.[0]) urls.push(options[0].url)
      }
      const steamUrl = steamId && steamArtworkUrl(kind, steamId)
      if (steamUrl) urls.push(steamUrl)
      for (const url of urls) {
        const rel = await attempt(() => this.deps.media.download(id, kind, url))
        if (rel) {
          repo.setArtwork(id, kind, rel, false)
          await this.deps.media.prune(id, kind, rel)
          gotArtwork = true
          break
        }
      }
    }

    // 4. Status
    const matched = steamGridDbId !== null || igdbId !== null || steamDetails !== null || (steamId !== null && gotArtwork)
    if (offline) {
      repo.setStatus(id, 'error', "Couldn't reach the metadata services. Will retry later.", this.now())
    } else if (errors.length) {
      repo.setStatus(id, 'error', errors[0], this.now())
    } else {
      repo.setStatus(id, matched ? 'matched' : 'unmatched', matched ? null : 'No confident match found. Use Fix match to pick one.', this.now())
    }
    this.deps.onGameUpdated(id)
    if (offline) throw offline
  }

  // ---- manual matching and artwork -----------------------------------------

  async search(query: string): Promise<MatchCandidate[]> {
    const p = this.providers()
    const q = query.trim()
    if (!q) return []
    if (p.igdb) return p.igdb.search(q)
    if (p.sgdb) return p.sgdb.search(q)
    throw new Error('Add a SteamGridDB key or IGDB credentials in Settings to search.')
  }

  /** Applies the user's chosen match, then refetches everything for it. */
  async applyMatch(id: number, candidate: MatchCandidate): Promise<Game | null> {
    const game = this.deps.store.get(id)
    if (!game) return null
    const p = this.providers()
    let steamGridDbId: number | null = null
    let igdbId: number | null = null
    if (candidate.provider === 'igdb') {
      igdbId = candidate.id
      if (p.sgdb) {
        const sgdb = p.sgdb
        steamGridDbId =
          (candidate.steamAppId ? (await sgdb.gameBySteamAppId(candidate.steamAppId))?.id : null) ??
          pickBestMatch(candidate.name, await sgdb.search(candidate.name), (c) => c.name)?.id ??
          null
      }
    } else {
      steamGridDbId = candidate.id
      if (p.igdb) igdbId = pickBestMatch(candidate.name, await p.igdb.search(candidate.name), (c) => c.name)?.id ?? null
    }
    // A new match is a fresh start: the user's text edits and artwork picks were for the old one.
    this.deps.repo.setMatch(id, { steamGridDbId, igdbId }, true)
    this.deps.repo.unlockDetails(id)
    this.deps.repo.unlockAllArtwork(id)
    await this.process(id, true)
    return this.deps.store.get(id)
  }

  async artworkOptions(id: number, kind: ArtworkKind): Promise<ArtworkOption[]> {
    const game = this.deps.store.get(id)
    const sgdb = this.providers().sgdb
    if (!game) return []
    if (!sgdb) throw new Error('Add a SteamGridDB API key in Settings to browse artwork.')
    let sgdbId = game.metadata.steamGridDbId
    if (sgdbId === null) {
      await this.process(id, false)
      sgdbId = this.deps.store.get(id)?.metadata.steamGridDbId ?? null
    }
    if (sgdbId === null) throw new Error('This game is not matched on SteamGridDB yet. Use Fix match first.')
    return sgdb.artwork(kind, sgdbId)
  }

  async setArtworkFromUrl(id: number, kind: ArtworkKind, url: string): Promise<Game | null> {
    const rel = await this.deps.media.download(id, kind, url)
    if (!rel) throw new Error('That image is no longer available.')
    this.deps.repo.setArtwork(id, kind, rel, true)
    await this.deps.media.prune(id, kind, rel)
    this.deps.onGameUpdated(id)
    return this.deps.store.get(id)
  }

  async setArtworkFromFile(id: number, kind: ArtworkKind, file: string): Promise<Game | null> {
    const rel = await this.deps.media.importFile(id, kind, file)
    this.deps.repo.setArtwork(id, kind, rel, true)
    await this.deps.media.prune(id, kind, rel)
    this.deps.onGameUpdated(id)
    return this.deps.store.get(id)
  }

  /** Goes back to automatic artwork for one kind. */
  async resetArtwork(id: number, kind: ArtworkKind): Promise<Game | null> {
    this.deps.repo.setArtwork(id, kind, null, false)
    await this.deps.media.prune(id, kind, null)
    await this.process(id, false).catch(() => {})
    return this.deps.store.get(id)
  }

  async checkKeys(): Promise<{ steamGridDb: KeyCheck; igdb: KeyCheck }> {
    const p = this.providers()
    const check = async (fn: (() => Promise<void>) | null): Promise<KeyCheck> => {
      if (!fn) return 'missing'
      try {
        await fn()
        return 'ok'
      } catch (err) {
        if (err instanceof HttpError && [400, 401, 403].includes(err.status)) return 'invalid'
        return { error: describe(err) }
      }
    }
    const [steamGridDb, igdb] = await Promise.all([
      check(p.sgdb ? () => p.sgdb!.checkKey() : null),
      check(p.igdb ? () => p.igdb!.checkCredentials() : null)
    ])
    return { steamGridDb, igdb }
  }
}
