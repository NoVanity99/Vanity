import type { Db } from '../db/database'
import type { GamePlayStats, GameSession } from '@shared/types'

export interface PlayStats {
  totalSeconds: number
  gamesPlayed: number
  sessions: number
  longest: { seconds: number; gameId: number; name: string; startedAt: number } | null
  top: { id: number; name: string; seconds: number; coverPath: string | null }[]
  /** Sessions started in the last `days` days, for per-day charts and streaks (bucketed in local time by the UI). */
  recent: { startedAt: number; seconds: number }[]
}

/** Playtime summary from the library and recorded play sessions. */
export function playStats(db: Db, now = Date.now(), days = 60): PlayStats {
  const totals = db
    .prepare('SELECT COALESCE(SUM(playtime_seconds), 0) AS total, SUM(playtime_seconds > 0) AS played FROM games')
    .get() as { total: number; played: number | null }
  const sessions = db.prepare('SELECT COUNT(*) FROM play_sessions WHERE duration_seconds > 0').pluck().get() as number
  const longest = db
    .prepare(
      `SELECT s.duration_seconds AS seconds, s.started_at AS startedAt, g.id AS gameId, g.name AS name
       FROM play_sessions s JOIN games g ON g.id = s.game_id ORDER BY s.duration_seconds DESC LIMIT 1`
    )
    .get() as PlayStats['longest'] | undefined
  const top = db
    .prepare('SELECT id, name, playtime_seconds AS seconds, cover_path AS coverPath FROM games WHERE playtime_seconds > 0 ORDER BY playtime_seconds DESC LIMIT 8')
    .all() as PlayStats['top']
  const recent = db
    .prepare('SELECT started_at AS startedAt, duration_seconds AS seconds FROM play_sessions WHERE started_at >= ? AND duration_seconds > 0 ORDER BY started_at')
    .all(now - days * 86_400_000) as PlayStats['recent']
  return {
    totalSeconds: totals.total,
    gamesPlayed: totals.played ?? 0,
    sessions,
    longest: longest && longest.seconds > 0 ? longest : null,
    top,
    recent
  }
}

/** Playtime facts for one game: sessions, averages, rank in the library and its session history. */
export function gamePlayStats(db: Db, gameId: number): GamePlayStats {
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_seconds), 0) AS total, MIN(started_at) AS first
       FROM play_sessions WHERE game_id = ? AND duration_seconds > 0`
    )
    .get(gameId) as { sessions: number; total: number; first: number | null }
  const longest = db
    .prepare('SELECT duration_seconds AS seconds, started_at AS startedAt FROM play_sessions WHERE game_id = ? AND duration_seconds > 0 ORDER BY duration_seconds DESC LIMIT 1')
    .get(gameId) as { seconds: number; startedAt: number } | undefined
  const game = db.prepare('SELECT playtime_seconds AS seconds, last_played_at AS last FROM games WHERE id = ?').get(gameId) as
    | { seconds: number; last: number | null }
    | undefined
  const seconds = game?.seconds ?? 0
  const library = db
    .prepare('SELECT COALESCE(SUM(playtime_seconds), 0) AS total, SUM(playtime_seconds > 0) AS played FROM games')
    .get() as { total: number; played: number | null }
  const ahead = db.prepare('SELECT COUNT(*) FROM games WHERE playtime_seconds > ?').pluck().get(seconds) as number
  const history = db
    .prepare(
      `SELECT started_at AS startedAt, ended_at AS endedAt, duration_seconds AS seconds
       FROM play_sessions WHERE game_id = ? AND duration_seconds > 0 ORDER BY started_at DESC LIMIT 500`
    )
    .all(gameId) as GameSession[]
  return {
    sessions: agg.sessions,
    averageSeconds: agg.sessions ? Math.round(agg.total / agg.sessions) : 0,
    longest: longest ?? null,
    // Playtime imported before sessions were recorded has no first session; fall back to the last launch.
    firstPlayedAt: agg.first ?? (seconds > 0 ? (game?.last ?? null) : null),
    rank: seconds > 0 ? ahead + 1 : null,
    playedGames: library.played ?? 0,
    share: library.total > 0 ? seconds / library.total : 0,
    history
  }
}
