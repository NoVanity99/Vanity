import type { Game, GameLive, Settings } from '@shared/types'
import type { Db } from '../db/database'
import { createLimiter, requestJson, type FetchFn } from '../metadata/http'
import { Igdb } from '../metadata/igdb'
import { SteamStore } from '../metadata/steamStore'
import { TwitchAppToken, TwitchHelix } from '../metadata/twitch'
import type { LibraryStore } from '../library/store'

const LIVE_TTL_MS = 10 * 60_000
const WORKSHOP_TTL_MS = 30 * 24 * 60 * 60_000
const LIBRARY_LOOKUPS = 600
/** Non-Steam games whose Steam page is looked up (once a month each) per pass. */
const ID_LOOKUPS_PER_PASS = 60

export interface LiveDeps {
  db: Db
  store: LibraryStore
  fetchFn: FetchFn
  getSettings(): Settings
  now?: () => number
}

/** Current Steam players via the keyless Steam Web API; null if unknown. */
export async function steamPlayers(fetchFn: FetchFn, appId: string): Promise<number | null> {
  const url = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${encodeURIComponent(appId)}`
  const res = await requestJson<{ response?: { player_count?: number; result?: number } }>(fetchFn, url, {}, 'Steam players')
  return res.response?.result === 1 && typeof res.response.player_count === 'number' ? res.response.player_count : null
}

/**
 * Live numbers for library games: Steam player counts (keyless), Twitch
 * viewers (with Twitch credentials), and whether a Steam game has a Workshop.
 * Everything is cached; failures just mean "no number".
 */
export class LiveService {
  private live = new Map<number, GameLive>()
  private libraryCache: { at: number; data: Record<number, number> } | null = null
  private steamLimit = createLimiter(80)
  private readonly now: () => number

  constructor(private deps: LiveDeps) {
    this.now = deps.now ?? Date.now
  }

  private kvGet<T>(key: string, maxAge: number): T | undefined {
    const row = this.deps.db.prepare('SELECT value, updated_at FROM kv WHERE key = ?').get(key) as { value: string; updated_at: number } | undefined
    if (!row || this.now() - row.updated_at > maxAge) return undefined
    try {
      return JSON.parse(row.value) as T
    } catch {
      return undefined
    }
  }

  private kvSet(key: string, value: unknown): void {
    this.deps.db
      .prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, JSON.stringify(value), this.now())
  }

  private twitch(): { igdb: Igdb; helix: TwitchHelix } | null {
    const s = this.deps.getSettings()
    if (!s.igdbClientId || !s.igdbClientSecret) return null
    const auth = new TwitchAppToken(s.igdbClientId, s.igdbClientSecret, this.deps.fetchFn, this.now)
    return { igdb: new Igdb(s.igdbClientId, s.igdbClientSecret, this.deps.fetchFn, this.now, auth), helix: new TwitchHelix(auth, this.deps.fetchFn) }
  }

  /** The game's Steam app ID: its own for Steam games, otherwise looked up on IGDB (cached). */
  async steamAppIdFor(game: Game): Promise<string | null> {
    if (game.source === 'steam') return /^\d+$/.test(game.externalId) ? game.externalId : null
    const igdbId = game.metadata.igdbId
    if (igdbId === null) return null
    const key = `live:steamid:${igdbId}`
    const cached = this.kvGet<string | null>(key, WORKSHOP_TTL_MS)
    if (cached !== undefined) return cached
    const t = this.twitch()
    if (!t) return null
    const rows = await t.igdb
      .queryWithSourceField<{ uid?: string }>('external_games', (field) => `fields uid; where game = ${Math.trunc(igdbId)} & ${field} = 1; limit 1;`)
      .catch(() => null)
    if (rows === null) return null
    const appId = rows[0]?.uid && /^\d+$/.test(rows[0].uid) ? rows[0].uid : null
    this.kvSet(key, appId)
    return appId
  }

  private async hasWorkshop(appId: string): Promise<boolean> {
    const key = `live:workshop:${appId}`
    const cached = this.kvGet<boolean>(key, WORKSHOP_TTL_MS)
    if (cached !== undefined) return cached
    const details = await new SteamStore(this.deps.fetchFn).details(appId).catch(() => null)
    if (!details) return false
    this.kvSet(key, details.hasWorkshop)
    return details.hasWorkshop
  }

  private async twitchViewers(igdbId: number | null): Promise<number | null> {
    const t = this.twitch()
    if (!t || igdbId === null) return null
    try {
      const games = await t.helix.get<{ data?: { id: string }[] }>('/games', { igdb_id: String(igdbId) })
      const twitchId = games.data?.[0]?.id
      if (!twitchId) return null
      const streams = await t.helix.get<{ data?: { viewer_count?: number }[] }>('/streams', { game_id: twitchId, first: '100' })
      return (streams.data ?? []).reduce((sum, s) => sum + (s.viewer_count ?? 0), 0)
    } catch {
      return null
    }
  }

  /** Live numbers for one game (cached for 10 minutes). */
  async forGame(id: number): Promise<GameLive | null> {
    const game = this.deps.store.get(id)
    if (!game) return null
    const hit = this.live.get(id)
    if (hit && this.now() - hit.checkedAt < LIVE_TTL_MS) return hit

    const appId = await this.steamAppIdFor(game).catch(() => null)
    const [players, viewers, workshop] = await Promise.all([
      appId ? steamPlayers(this.deps.fetchFn, appId).catch(() => null) : Promise.resolve(null),
      this.twitchViewers(game.metadata.igdbId),
      // Workshop items are subscribed to through Steam, so only offer it for Steam copies.
      appId && game.source === 'steam' ? this.hasWorkshop(appId) : Promise.resolve(false)
    ])
    const result: GameLive = { players, viewers, steamAppId: appId, workshop, checkedAt: this.now() }
    this.live.set(id, result)
    return result
  }

  /** The Steam app ID if it is known without asking anyone: `undefined` means it would need a look-up. */
  private knownAppId(game: Game): string | null | undefined {
    if (game.source === 'steam') return /^\d+$/.test(game.externalId) ? game.externalId : null
    if (game.metadata.igdbId === null) return null
    return this.kvGet<string | null>(`live:steamid:${game.metadata.igdbId}`, WORKSHOP_TTL_MS)
  }

  private resolving: Promise<void> | null = null

  /**
   * Current Steam players for the games in the library, by game ID (cached for 10 minutes): the
   * same number the game page shows. Steam games are counted straight away. Games from other
   * launchers need their Steam page found first: that happens in the background, a batch at a
   * time, and they join the answer the next time it is asked for.
   */
  async libraryPlayers(): Promise<Record<number, number>> {
    if (this.libraryCache && this.now() - this.libraryCache.at < LIVE_TTL_MS) return this.libraryCache.data
    const games = this.deps.store.list().filter((g) => !g.hidden)
    const withId: { id: number; appId: string }[] = []
    const unknown: Game[] = []
    for (const g of games) {
      const appId = this.knownAppId(g)
      if (appId === undefined) unknown.push(g)
      else if (appId) withId.push({ id: g.id, appId })
    }
    // One request per Steam game, however many copies of it are in the library.
    const counts = new Map<string, Promise<number | null>>()
    const data: Record<number, number> = {}
    await Promise.all(
      withId.slice(0, LIBRARY_LOOKUPS).map(async (g) => {
        let count = counts.get(g.appId)
        if (!count) counts.set(g.appId, (count = this.steamLimit(() => steamPlayers(this.deps.fetchFn, g.appId).catch(() => null))))
        const n = await count
        if (n !== null) data[g.id] = n
      })
    )
    this.libraryCache = { at: this.now(), data }
    if (unknown.length && !this.resolving) {
      this.resolving = (async () => {
        let found = false
        for (const g of unknown.slice(0, ID_LOOKUPS_PER_PASS)) found = !!(await this.steamAppIdFor(g).catch(() => null)) || found
        // New Steam pages were found: count their players on the next ask instead of in ten minutes.
        if (found) this.libraryCache = null
      })().finally(() => (this.resolving = null))
    }
    return data
  }
}
