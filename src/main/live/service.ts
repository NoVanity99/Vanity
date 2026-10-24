import type { Game, GameLive, Settings } from '@shared/types'
import type { Db } from '../db/database'
import { createLimiter, requestJson, type FetchFn } from '../metadata/http'
import { Igdb } from '../metadata/igdb'
import { SteamStore } from '../metadata/steamStore'
import { TwitchAppToken, TwitchHelix } from '../metadata/twitch'
import type { LibraryStore } from '../library/store'

const LIVE_TTL_MS = 10 * 60_000
const WORKSHOP_TTL_MS = 30 * 24 * 60 * 60_000
const LIBRARY_LOOKUPS = 150

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

  /** Current Steam players for every Steam game in the library (cached for 10 minutes). */
  async libraryPlayers(): Promise<Record<number, number>> {
    if (this.libraryCache && this.now() - this.libraryCache.at < LIVE_TTL_MS) return this.libraryCache.data
    const games = this.deps.store
      .list()
      .filter((g) => g.source === 'steam' && /^\d+$/.test(g.externalId) && !g.hidden)
      .slice(0, LIBRARY_LOOKUPS)
    const data: Record<number, number> = {}
    await Promise.all(
      games.map((g) =>
        this.steamLimit(async () => {
          const n = await steamPlayers(this.deps.fetchFn, g.externalId).catch(() => null)
          if (n !== null) data[g.id] = n
        })
      )
    )
    this.libraryCache = { at: this.now(), data }
    return data
  }
}
