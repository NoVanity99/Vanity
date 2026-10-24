import type { Settings, StoreLauncher, TrendingGame, TrendingState, UpcomingGame } from '@shared/types'
import type { Db } from '../db/database'
import { NetworkError, type FetchFn } from '../metadata/http'
import { Igdb } from '../metadata/igdb'
import { TwitchAppToken, TwitchHelix } from '../metadata/twitch'
import { rankTrending, toUpcoming, type Signals } from './aggregate'
import { ALL_LAUNCHERS, LAUNCHERS, openStore } from './launcherLinks'
import { fetchIgdbGames, fetchIgdbPopularity, fetchIgdbUpcoming, fetchSteamPlayers, fetchTwitchTop, fetchTwitchViewers } from './sources'

/** Cached lists older than this are refreshed when the tab opens; the timer refreshes on the same cadence. */
export const REFRESH_MS = 45 * 60_000
const CACHE_KEY = 'trending:v1'
const CANDIDATES = 80
const TWITCH_CANDIDATES = 30
const TWITCH_VIEWER_LOOKUPS = 15
const STEAM_LOOKUPS = 60

export interface TrendingDeps {
  db: Db
  fetchFn: FetchFn
  getSettings(): Settings
  /** True if the launcher's URI protocol is registered on this PC. */
  isProtocolRegistered(protocol: string): boolean
  openExternal(url: string): Promise<void>
  onUpdate(state: TrendingState): void
  now?: () => number
}

interface Cached {
  games: TrendingGame[]
  /** Missing in caches written before the Coming soon banner existed. */
  upcoming?: UpcomingGame[]
  updatedAt: number
}

export class TrendingService {
  private cache: Cached | null
  private inFlight: Promise<void> | null = null
  private error: string | null = null
  private needsKeys = false
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly now: () => number

  constructor(private deps: TrendingDeps) {
    this.now = deps.now ?? Date.now
    this.cache = this.readCache()
  }

  private readCache(): Cached | null {
    try {
      const row = this.deps.db.prepare('SELECT value FROM kv WHERE key = ?').pluck().get(CACHE_KEY) as string | undefined
      if (!row) return null
      const parsed = JSON.parse(row) as Cached
      return Array.isArray(parsed.games) && typeof parsed.updatedAt === 'number' ? parsed : null
    } catch {
      return null
    }
  }

  private writeCache(c: Cached): void {
    this.deps.db
      .prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(CACHE_KEY, JSON.stringify(c), c.updatedAt)
  }

  state(): TrendingState {
    return {
      games: this.cache?.games ?? [],
      upcoming: this.cache?.upcoming ?? [],
      updatedAt: this.cache?.updatedAt ?? null,
      refreshing: this.inFlight !== null,
      error: this.error,
      needsKeys: this.needsKeys
    }
  }

  private emit(): void {
    this.deps.onUpdate(this.state())
  }

  isStale(): boolean {
    return !this.cache || this.now() - this.cache.updatedAt > REFRESH_MS
  }

  /** The cached state straight away; refreshes in the background if it's old. */
  get(): TrendingState {
    if (this.isStale()) void this.refresh()
    return this.state()
  }

  /** Fetches a fresh list. Concurrent calls share one fetch. Never throws; failures land in state().error. */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.run()
    // After assigning inFlight, so the update says "refreshing".
    this.emit()
    return this.inFlight
  }

  private async run(): Promise<void> {
    // Let refresh() assign inFlight before this does any work.
    await Promise.resolve()
    try {
      const { games, upcoming } = await this.fetchTrending()
      this.cache = { games, upcoming, updatedAt: this.now() }
      this.writeCache(this.cache)
      this.error = null
      this.needsKeys = false
    } catch (err) {
      this.error = describe(err)
      this.needsKeys = err instanceof MissingKeysError
      console.warn('[trending] refresh failed:', err)
    } finally {
      this.inFlight = null
      this.emit()
    }
  }

  /** Refresh every REFRESH_MS while the app runs, so the tab is ready when opened. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS)
    if (this.isStale()) void this.refresh()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  installed(): Record<StoreLauncher, boolean> {
    return Object.fromEntries(ALL_LAUNCHERS.map((l) => [l, this.isInstalled(l)])) as Record<StoreLauncher, boolean>
  }

  private isInstalled(l: StoreLauncher): boolean {
    const protocol = LAUNCHERS[l].protocol
    try {
      return !!protocol && this.deps.isProtocolRegistered(protocol)
    } catch {
      return false
    }
  }

  /**
   * Opens a trending game's page in the given store: its launcher if installed
   * and linkable, else the browser. Links come from our own cache, not the UI.
   */
  async open(gameId: number, launcher: StoreLauncher): Promise<'launcher' | 'browser'> {
    const game = this.cache?.games.find((g) => g.id === gameId) ?? this.cache?.upcoming?.find((g) => g.id === gameId)
    const link = game?.stores.find((s) => s.launcher === launcher)
    if (!link) throw new Error('That store link is no longer available. Refresh Trending and try again.')
    return openStore(link, { isInstalled: (l) => this.isInstalled(l), openExternal: this.deps.openExternal })
  }

  // ---- the aggregation pipeline --------------------------------------------

  private async fetchTrending(): Promise<{ games: TrendingGame[]; upcoming: UpcomingGame[] }> {
    const s = this.deps.getSettings()
    if (!s.igdbClientId || !s.igdbClientSecret) throw new MissingKeysError()
    const { fetchFn } = this.deps
    const auth = new TwitchAppToken(s.igdbClientId, s.igdbClientSecret, fetchFn, this.now)
    const igdb = new Igdb(s.igdbClientId, s.igdbClientSecret, fetchFn, this.now, auth)
    const helix = new TwitchHelix(auth, fetchFn)

    // IGDB is required; Twitch only improves the ranking and the banner is extra, so their failures are tolerated.
    const [igdbScores, twitchTop, upcomingRaw] = await Promise.all([
      fetchIgdbPopularity(igdb),
      fetchTwitchTop(helix).catch(() => []),
      fetchIgdbUpcoming(igdb, this.now()).catch((err) => {
        console.warn('[trending] upcoming games failed:', err)
        return []
      })
    ])
    if (igdbScores.size === 0 && twitchTop.length === 0) throw new Error('IGDB returned no popularity data.')

    const byIgdb = [...igdbScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES).map(([id]) => id)
    const fromTwitch = twitchTop.slice(0, TWITCH_CANDIDATES).map((t) => t.igdbId)
    const games = await fetchIgdbGames(igdb, [...new Set([...byIgdb, ...fromTwitch])])

    const steamIds = games.filter((g) => g.steamAppId).slice(0, STEAM_LOOKUPS)
    const twitchForViewers = twitchTop.filter((t) => games.some((g) => g.id === t.igdbId)).slice(0, TWITCH_VIEWER_LOOKUPS)
    const [players, viewers] = await Promise.all([
      fetchSteamPlayers(fetchFn, steamIds.map((g) => g.steamAppId!)).catch(() => new Map<string, number>()),
      fetchTwitchViewers(helix, twitchForViewers.map((t) => t.twitchId)).catch(() => new Map<string, number>())
    ])

    const signals: Signals = {
      igdb: igdbScores,
      twitchRank: new Map(twitchTop.map((t) => [t.igdbId, t.rank])),
      twitchViewers: new Map(twitchForViewers.flatMap((t) => (viewers.has(t.twitchId) ? [[t.igdbId, viewers.get(t.twitchId)!]] : []))),
      steamPlayers: new Map(steamIds.flatMap((g) => (players.has(g.steamAppId!) ? [[g.id, players.get(g.steamAppId!)!]] : [])))
    }
    const ranked = rankTrending(games, signals)
    if (ranked.length === 0) throw new Error('No trending PC games found.')
    return { games: ranked, upcoming: toUpcoming(upcomingRaw) }
  }
}

export class MissingKeysError extends Error {
  constructor() {
    super('Trending needs IGDB credentials (a Twitch client ID and secret). Add MAIN_VITE_IGDB_CLIENT_ID and MAIN_VITE_IGDB_CLIENT_SECRET to .env.local and restart.')
  }
}

function describe(err: unknown): string {
  if (err instanceof MissingKeysError) return err.message
  if (err instanceof NetworkError) return "Couldn't reach IGDB. Check your internet connection."
  const msg = err instanceof Error ? err.message : String(err)
  if (/HTTP 40[13]/.test(msg)) return 'IGDB rejected the Twitch client ID or secret.'
  return msg
}
