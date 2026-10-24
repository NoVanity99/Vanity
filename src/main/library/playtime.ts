import type { Db } from '../db/database'

/** Writes launch times, play sessions and playtime totals. */
export interface PlaytimeStore {
  recordLaunch(gameId: number, at: number): void
  startSession(gameId: number, startedAt: number): number
  /** Adds seconds to both the session and the game's total, and moves the session's end time forward. */
  addTime(sessionId: number, gameId: number, seconds: number, endedAt: number): void
}

export function createPlaytimeStore(db: Db): PlaytimeStore {
  const launch = db.prepare<[number, number]>('UPDATE games SET last_played_at = ? WHERE id = ?')
  const start = db.prepare<[number, number, number]>('INSERT INTO play_sessions (game_id, started_at, ended_at) VALUES (?, ?, ?)')
  const sessionTime = db.prepare<[number, number, number]>(
    'UPDATE play_sessions SET duration_seconds = duration_seconds + ?, ended_at = ? WHERE id = ?'
  )
  const gameTime = db.prepare<[number, number]>('UPDATE games SET playtime_seconds = playtime_seconds + ? WHERE id = ?')
  const addTime = db.transaction((sessionId: number, gameId: number, seconds: number, endedAt: number) => {
    sessionTime.run(seconds, endedAt, sessionId)
    gameTime.run(seconds, gameId)
  })

  return {
    recordLaunch: (gameId, at) => void launch.run(at, gameId),
    startSession: (gameId, startedAt) => Number(start.run(gameId, startedAt, startedAt).lastInsertRowid),
    addTime: (sessionId, gameId, seconds, endedAt) => {
      if (seconds > 0) addTime(sessionId, gameId, seconds, endedAt)
    }
  }
}
