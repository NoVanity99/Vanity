import type { Game, GameDetails, Settings } from '@shared/types'
import type { Db } from '../db/database'
import type { FetchFn } from '../metadata/http'
import { Igdb } from '../metadata/igdb'
import type { LibraryStore } from '../library/store'
import { folderSize } from '../util/fs'
import { fetchIgdbExtra, fetchSteamExtra, fetchSteamNews, fetchSteamReviews, fetchTimeToBeat } from './sources'

const DETAILS_TTL_MS = 12 * 60 * 60_000
/** A failed or partial fetch is retried sooner. */
const PARTIAL_TTL_MS = 30 * 60_000
const SIZE_TTL_MS = 24 * 60 * 60_000

export interface DetailsDeps {
  db: Db
  store: LibraryStore
  fetchFn: FetchFn
  getSettings(): Settings
  steamAppIdFor(game: Game): Promise<string | null>
  now?: () => number
}

type Cached = Omit<GameDetails, 'similar'> & { similar: Omit<GameDetails['similar'][number], 'libraryId'>[] }

const normal = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Everything extra shown on a game page: ratings, time to beat, credits,
 * media, news and similar games, from IGDB (needs keys) and Steam (keyless).
 * Each source is optional; whatever answers is cached in the kv table.
 */
export class DetailsService {
  private inFlight = new Map<number, Promise<GameDetails | null>>()
  private sizing = new Map<number, Promise<number | null>>()
  private readonly now: () => number

  constructor(private deps: DetailsDeps) {
    this.now = deps.now ?? Date.now
  }

  private kvGet<T>(key: string): { value: T; at: number } | null {
    const row = this.deps.db.prepare('SELECT value, updated_at FROM kv WHERE key = ?').get(key) as { value: string; updated_at: number } | undefined
    if (!row) return null
    try {
      return { value: JSON.parse(row.value) as T, at: row.updated_at }
    } catch {
      return null
    }
  }

  private kvSet(key: string, value: unknown): void {
    this.deps.db
      .prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, JSON.stringify(value), this.now())
  }

  private igdb(): Igdb | null {
    const s = this.deps.getSettings()
    return s.igdbClientId && s.igdbClientSecret ? new Igdb(s.igdbClientId, s.igdbClientSecret, this.deps.fetchFn, this.now) : null
  }

  /** Marks similar games that are in the library, so the page can link to them. */
  private withLibrary(c: Cached): GameDetails {
    const games = this.deps.store.list()
    const byIgdb = new Map(games.filter((g) => g.metadata.igdbId !== null).map((g) => [g.metadata.igdbId!, g.id]))
    const byName = new Map(games.map((g) => [normal(g.name), g.id]))
    return { ...c, similar: c.similar.map((s) => ({ ...s, libraryId: byIgdb.get(s.igdbId) ?? byName.get(normal(s.name)) ?? null })) }
  }

  async forGame(id: number, force = false): Promise<GameDetails | null> {
    const game = this.deps.store.get(id)
    if (!game) return null
    const key = `details:v1:${id}:${game.metadata.igdbId ?? '-'}`
    const hit = this.kvGet<Cached>(key)
    if (hit && !force) {
      const complete = hit.value.sources.igdb || !this.igdb()
      if (this.now() - hit.at < (complete ? DETAILS_TTL_MS : PARTIAL_TTL_MS)) return this.withLibrary(hit.value)
    }
    let running = this.inFlight.get(id)
    if (!running) {
      running = this.fetch(game)
        .then((c) => {
          if (c.sources.igdb || c.sources.steam) this.kvSet(key, c)
          // Nothing answered (offline?): fall back to what we had.
          else if (hit) return this.withLibrary(hit.value)
          return this.withLibrary(c)
        })
        .finally(() => this.inFlight.delete(id))
      this.inFlight.set(id, running)
    }
    return running
  }

  private async fetch(game: Game): Promise<Cached> {
    const igdb = this.igdb()
    const igdbId = game.metadata.igdbId
    const appId = await this.deps.steamAppIdFor(game).catch(() => null)
    const quiet = <T>(p: Promise<T> | null, label: string): Promise<T | null> =>
      p
        ? p.catch((err) => {
            console.warn(`[details] ${label} failed:`, err instanceof Error ? err.message : err)
            return null
          })
        : Promise.resolve(null)

    const [extra, ttb, steam, reviews, news] = await Promise.all([
      quiet(igdb && igdbId !== null ? fetchIgdbExtra(igdb, igdbId) : null, 'IGDB details'),
      quiet(igdb && igdbId !== null ? fetchTimeToBeat(igdb, igdbId) : null, 'time to beat'),
      quiet(appId ? fetchSteamExtra(this.deps.fetchFn, appId) : null, 'Steam store'),
      quiet(appId ? fetchSteamReviews(this.deps.fetchFn, appId) : null, 'Steam reviews'),
      quiet(appId ? fetchSteamNews(this.deps.fetchFn, appId) : null, 'Steam news')
    ])

    const pick = (a: string[] | undefined, b: string[] | undefined): string[] => (a?.length ? a : (b ?? []))
    return {
      ratings: { critics: extra?.critics ?? null, players: extra?.players ?? null, metacritic: steam?.metacritic ?? null, steam: reviews },
      timeToBeat: ttb,
      storyline: extra?.storyline ?? null,
      developers: pick(extra?.developers, steam?.developers),
      publishers: pick(extra?.publishers, steam?.publishers),
      franchise: extra?.franchise ?? null,
      modes: extra?.modes ?? [],
      perspectives: extra?.perspectives ?? [],
      themes: extra?.themes ?? [],
      platforms: extra?.platforms ?? [],
      features: steam?.features ?? [],
      languages: steam?.languages ?? [],
      achievements: steam?.achievements ?? null,
      dlcCount: steam?.dlcCount ?? null,
      price: steam?.price ?? null,
      requirements: steam?.requirements ?? null,
      website: steam?.website ?? null,
      screenshots: extra?.screenshots.length ? extra.screenshots : (steam?.screenshots ?? []),
      videos: extra?.videos ?? [],
      similar: extra?.similar ?? [],
      news: news ?? [],
      sources: { igdb: extra !== null || ttb !== null, steam: steam !== null || reviews !== null || (news?.length ?? 0) > 0 },
      fetchedAt: this.now()
    }
  }

  /** Bytes used by the game's install folder (cached for a day), or null if it has none. */
  async diskSize(id: number): Promise<number | null> {
    const game = this.deps.store.get(id)
    const folder = game?.installPath
    if (!game || !folder) return null
    const key = `disksize:${id}:${folder}`
    const hit = this.kvGet<number>(key)
    if (hit && this.now() - hit.at < SIZE_TTL_MS) return hit.value
    let running = this.sizing.get(id)
    if (!running) {
      running = folderSize(folder)
        .then(({ bytes }) => {
          const size = bytes > 0 ? bytes : null
          if (size !== null) this.kvSet(key, size)
          return size
        })
        .finally(() => this.sizing.delete(id))
      this.sizing.set(id, running)
    }
    return running
  }
}
