import type { Game, SessionState } from '@shared/types'
import type { Db } from '../main/db/database'
import type { PlaytimeStore } from '../main/library/playtime'

/** Shorter than this isn't counted as playing (a mis-tap, or the game failing to open). */
const MIN_SECONDS = 10
/** Without usage access, a "session" is the time until you come back to Vanity, at most this long. */
const MAX_FALLBACK_MS = 6 * 60 * 60_000
/** On the first sync, look this far back for games played before Vanity was installed. */
const FIRST_LOOKBACK_MS = 7 * 86_400_000
const SYNC_KEY = 'mobile:usage-synced'

export interface MobileTrackerDeps {
  db: Db
  playtime: PlaytimeStore
  /** Android games in the library. */
  games(): Game[]
  launch(packageName: string): Promise<void>
  usageAccess(): Promise<boolean>
  usage(since: number, packages: string[]): Promise<{ packageName: string; start: number; end: number }[]>
  onChange(gameId: number, state: SessionState): void
  now?: () => number
}

/**
 * Playtime on Android. Apps can't watch each other run, so Vanity works it out when you come back:
 * - with "Usage access" turned on, it asks Android how long each game was on screen
 *   (this also counts games you opened outside Vanity);
 * - without it, it counts from pressing Play until you return to Vanity.
 */
export class MobileTracker {
  private launched = new Map<number, number>()
  private syncing: Promise<void> | null = null
  private readonly now: () => number

  constructor(private deps: MobileTrackerDeps) {
    this.now = deps.now ?? Date.now
  }

  states(): Record<number, Exclude<SessionState, 'stopped'>> {
    return Object.fromEntries([...this.launched.keys()].map((id) => [id, 'running' as const]))
  }

  running(): { id: number; startedAt: number } | null {
    const first = this.launched.entries().next().value
    return first ? { id: first[0], startedAt: first[1] } : null
  }

  async launch(game: Game): Promise<void> {
    await this.deps.launch(game.externalId)
    const at = this.now()
    this.setLastPlayed(game.id, at)
    this.launched.set(game.id, at)
    this.deps.onChange(game.id, 'running')
  }

  private setLastPlayed(gameId: number, at: number): void {
    this.deps.db.prepare('UPDATE games SET last_played_at = MAX(COALESCE(last_played_at, 0), ?) WHERE id = ?').run(at, gameId)
  }

  private record(gameId: number, start: number, end: number): boolean {
    const seconds = Math.round((end - start) / 1000)
    if (seconds < MIN_SECONDS) return false
    const session = this.deps.playtime.startSession(gameId, start)
    this.deps.playtime.addTime(session, gameId, seconds, end)
    this.setLastPlayed(gameId, start)
    return true
  }

  private kv(key: string): number | null {
    const v = this.deps.db.prepare('SELECT value FROM kv WHERE key = ?').pluck().get(key) as string | undefined
    return v ? Number(v) : null
  }

  private setKv(key: string, value: number): void {
    this.deps.db
      .prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, String(value), this.now())
  }

  /**
   * The user ended the game from Vanity: records the time since it was opened and stops showing it
   * as running. Returns its package name (so Android can be asked to close it), or null.
   */
  stop(gameId: number): string | null {
    const startedAt = this.launched.get(gameId)
    if (startedAt === undefined) return null
    const game = this.deps.games().find((g) => g.id === gameId)
    this.launched.delete(gameId)
    this.record(gameId, startedAt, Math.min(this.now(), startedAt + MAX_FALLBACK_MS))
    this.deps.onChange(gameId, 'stopped')
    return game?.externalId ?? null
  }

  /** Call when Vanity comes back to the front (and at start): records what was played meanwhile. */
  sync(): Promise<void> {
    this.syncing ??= this.run().finally(() => (this.syncing = null))
    return this.syncing
  }

  private async run(): Promise<void> {
    const now = this.now()
    const games = this.deps.games()
    const byPackage = new Map(games.map((g) => [g.externalId, g]))
    const touched = new Set<number>()
    let precise = false
    try {
      precise = await this.deps.usageAccess()
    } catch {
      precise = false
    }

    if (precise) {
      const since = this.kv(SYNC_KEY) ?? now - FIRST_LOOKBACK_MS
      try {
        const sessions = await this.deps.usage(since, [...byPackage.keys()])
        for (const s of sessions) {
          const game = byPackage.get(s.packageName)
          if (game && s.end <= now + 1000 && s.start >= since && this.record(game.id, s.start, s.end)) touched.add(game.id)
        }
        this.setKv(SYNC_KEY, now)
      } catch (err) {
        console.warn('[playtime] could not read app usage:', err)
        precise = false
      }
    }
    if (!precise) {
      for (const [id, startedAt] of this.launched) {
        if (this.record(id, startedAt, Math.min(now, startedAt + MAX_FALLBACK_MS))) touched.add(id)
      }
      // Later, if usage access is turned on, don't count these sessions a second time.
      if (this.launched.size) this.setKv(SYNC_KEY, now)
    }

    // Everything launched from Vanity has ended (you're back in Vanity). Announce after the
    // time is saved, so the session recap reads the new totals.
    const ended = new Set([...this.launched.keys(), ...touched])
    this.launched.clear()
    for (const id of ended) this.deps.onChange(id, 'stopped')
  }
}
