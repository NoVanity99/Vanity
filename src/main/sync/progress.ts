import { BADGES, dayOf, summarize, type ProgressFacts } from '@shared/progress'
import type { CloudGame, SyncPrefs } from '@shared/sync'
import type { Progress, ProgressGame, SyncState } from '@shared/types'
import { gameKey } from '../account/gameKey'
import type { Db } from '../db/database'
import type { Kv } from '../db/kv'

/** A game you have on another device but not in this one's library, as last seen in the cloud. */
export type CloudOnlyGame = CloudGame & Partial<Pick<SyncPrefs, 'favorite' | 'playStatus' | 'userRating'>>

export const KV = {
  deviceId: 'sync:device-id',
  /** Days played, merged from every device. */
  days: 'sync:days',
  cloudOnly: 'sync:cloud-only-games',
  collectionsAt: 'sync:collections-at',
  settingsAt: 'sync:settings-at',
  /** Collection id → game keys in it that this device doesn't have, so they aren't lost on the next save. */
  orphans: 'sync:collection-orphans',
  lastSyncedAt: 'sync:last-synced-at',
  /** The account this device's cloud copy belongs to. */
  account: 'sync:account',
  /** Steam achievements unlocked (filled in once a Steam account is linked). */
  steamAchievements: 'steam:achievements-unlocked'
} as const

export interface LocalGameRow {
  id: number
  name: string
  /** This device only. */
  playtime_seconds: number
  cloud_playtime_seconds: number
  cloud_launches: number
  last_played_at: number | null
  favorite: number
  play_status: string | null
  user_rating: number | null
  notes: string | null
  user_updated_at: number
  cover_path: string | null
  icon_path: string | null
  /** Play sessions recorded on this device. */
  sessions: number
  first_session: number | null
}

/** Every game in this device's library, with its local play-session count. */
export function localGames(db: Db): LocalGameRow[] {
  return db
    .prepare(
      `SELECT g.id, g.name, g.playtime_seconds, g.cloud_playtime_seconds, g.cloud_launches, g.last_played_at, g.favorite,
              g.play_status, g.user_rating, g.notes, g.user_updated_at, g.cover_path, g.icon_path,
              (SELECT COUNT(*) FROM play_sessions s WHERE s.game_id = g.id) AS sessions,
              (SELECT MIN(started_at) FROM play_sessions s WHERE s.game_id = g.id) AS first_session
       FROM games g ORDER BY g.id`
    )
    .all() as LocalGameRow[]
}

/** How often a game was started on this device: recorded sessions, or at least once if it was ever played. */
export function localLaunches(r: LocalGameRow): number {
  return Math.max(r.sessions, r.playtime_seconds > 0 || r.last_played_at ? 1 : 0)
}

/** The days with any recorded play on this device (local calendar days). */
export function localDays(db: Db): string[] {
  const rows = db.prepare('SELECT started_at FROM play_sessions WHERE duration_seconds > 0').all() as { started_at: number }[]
  return [...new Set(rows.map((r) => dayOf(r.started_at)))]
}

export function unlockedBadges(db: Db): Record<string, number> {
  const rows = db.prepare('SELECT id, unlocked_at FROM badges').all() as { id: string; unlocked_at: number }[]
  return Object.fromEntries(rows.map((r) => [r.id, r.unlocked_at]))
}

/** Records badges (the earliest unlock time wins, so merging from the cloud never moves one later). */
export function saveBadges(db: Db, badges: Record<string, number>): void {
  const put = db.prepare('INSERT INTO badges (id, unlocked_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET unlocked_at = MIN(unlocked_at, excluded.unlocked_at)')
  for (const [id, at] of Object.entries(badges)) if (BADGES.some((b) => b.id === id) && Number.isFinite(at) && at > 0) put.run(id, Math.floor(at))
}

interface Merged {
  key: string
  name: string
  seconds: number
  launches: number
  last: number | null
  favorite: boolean
  playStatus: string | null
  rated: boolean
  gameId: number | null
  coverPath: string | null
  iconPath: string | null
}

/** One entry per game (several library entries can be the same game), plus games only your other devices have. */
function mergedGames(db: Db, kv: Kv): Merged[] {
  const byKey = new Map<string, Merged>()
  for (const r of localGames(db)) {
    const key = gameKey(r.name)
    const seconds = r.playtime_seconds + r.cloud_playtime_seconds
    const launches = localLaunches(r) + r.cloud_launches
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { key, name: r.name, seconds, launches, last: r.last_played_at, favorite: r.favorite === 1, playStatus: r.play_status, rated: !!r.user_rating, gameId: r.id, coverPath: r.cover_path, iconPath: r.icon_path })
    } else {
      prev.seconds += seconds
      prev.launches += launches
      prev.last = Math.max(prev.last ?? 0, r.last_played_at ?? 0) || null
      prev.favorite ||= r.favorite === 1
      prev.playStatus ??= r.play_status
      prev.rated ||= !!r.user_rating
      prev.coverPath ??= r.cover_path
      prev.iconPath ??= r.icon_path
    }
  }
  for (const g of kv.get<CloudOnlyGame[]>(KV.cloudOnly) ?? []) {
    if (byKey.has(g.key)) continue
    byKey.set(g.key, { key: g.key, name: g.name, seconds: g.playtimeSeconds, launches: g.launches, last: g.lastPlayedAt, favorite: g.favorite === true, playStatus: g.playStatus ?? null, rated: !!g.userRating, gameId: null, coverPath: null, iconPath: null })
  }
  return [...byKey.values()]
}

export function progressFacts(db: Db, kv: Kv): ProgressFacts {
  const games = mergedGames(db, kv)
  const played = games.filter((g) => g.seconds > 0 || g.launches > 0)
  return {
    playtimeSeconds: games.reduce((n, g) => n + g.seconds, 0),
    gamesPlayed: played.length,
    launches: games.reduce((n, g) => n + g.launches, 0),
    days: [...new Set([...(kv.get<string[]>(KV.days) ?? []), ...localDays(db)])],
    topGameSeconds: games.reduce((n, g) => Math.max(n, g.seconds), 0),
    gamesBeaten: games.filter((g) => g.playStatus === 'beaten').length,
    gamesCompleted: games.filter((g) => g.playStatus === 'completed').length,
    gamesRated: games.filter((g) => g.rated).length,
    favorites: games.filter((g) => g.favorite).length,
    collections: db.prepare('SELECT COUNT(*) FROM collections').pluck().get() as number,
    steamAchievements: Math.max(0, Math.floor(kv.get<number>(KV.steamAchievements) ?? 0))
  }
}

/**
 * Your level, XP, streaks and badges, worked out from everything this device knows (its own
 * library and sessions, plus what cloud sync brought in from your other devices).
 * Newly earned badges are recorded with the current time.
 */
export function computeProgress(db: Db, kv: Kv, sync: SyncState, now = Date.now()): Progress {
  const facts = progressFacts(db, kv)
  const summary = summarize(facts, dayOf(now))

  let unlocked = unlockedBadges(db)
  const fresh = summary.earned.filter((id) => !(id in unlocked))
  if (fresh.length) {
    saveBadges(db, Object.fromEntries(fresh.map((id) => [id, now])))
    unlocked = unlockedBadges(db)
  }

  const toGame = (g: Merged): ProgressGame => ({ key: g.key, name: g.name, playtimeSeconds: g.seconds, launches: g.launches, lastPlayedAt: g.last, gameId: g.gameId, coverPath: g.coverPath, iconPath: g.iconPath })
  const games = mergedGames(db, kv)
  const extra = { level: summary.level.level, bestStreak: summary.streak.best }
  return {
    xp: summary.xp,
    level: summary.level,
    breakdown: summary.breakdown,
    totals: {
      playtimeSeconds: facts.playtimeSeconds,
      gamesPlayed: facts.gamesPlayed,
      launches: facts.launches,
      daysPlayed: summary.breakdown.daysPlayed ? new Set(facts.days).size : 0,
      currentStreak: summary.streak.current,
      bestStreak: summary.streak.best,
      favorites: facts.favorites,
      steamAchievements: facts.steamAchievements
    },
    topGames: games
      .filter((g) => g.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10)
      .map(toGame),
    recentGames: games
      .filter((g) => g.last)
      .sort((a, b) => (b.last ?? 0) - (a.last ?? 0))
      .slice(0, 6)
      .map(toGame),
    badges: BADGES.map((b) => {
      const m = b.measure(facts, extra)
      // A badge stays unlocked once earned, even if the numbers behind it later change.
      return { id: b.id, name: b.name, description: b.description, icon: b.icon, unlockedAt: unlocked[b.id] ?? null, current: m.current, target: m.target }
    }),
    sync
  }
}
