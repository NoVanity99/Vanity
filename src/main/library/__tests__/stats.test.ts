import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../db/database'
import { createPlaytimeStore } from '../playtime'
import { playStats } from '../stats'
import { createSqliteStore } from '../store'

describe('playStats', () => {
  it('summarises playtime and sessions', () => {
    const db = openDatabase(':memory:').db
    const store = createSqliteStore(db)
    const [a, b, c] = store.upsert([
      { source: 'steam', externalId: '1', name: 'Alpha', installPath: null, executablePath: null },
      { source: 'steam', externalId: '2', name: 'Beta', installPath: null, executablePath: null },
      { source: 'steam', externalId: '3', name: 'Never Played', installPath: null, executablePath: null }
    ]).games
    const pt = createPlaytimeStore(db)
    const now = 100 * 86_400_000
    const s1 = pt.startSession(a.id, now - 2 * 86_400_000)
    pt.addTime(s1, a.id, 3600, now - 2 * 86_400_000 + 3600_000)
    const s2 = pt.startSession(b.id, now - 3600_000)
    pt.addTime(s2, b.id, 7200, now)
    const old = pt.startSession(a.id, now - 90 * 86_400_000)
    pt.addTime(old, a.id, 600, now - 90 * 86_400_000)

    const stats = playStats(db, now)
    expect(stats).toMatchObject({ totalSeconds: 11400, gamesPlayed: 2, sessions: 3 })
    expect(stats.longest).toMatchObject({ seconds: 7200, name: 'Beta' })
    expect(stats.top.map((t) => [t.name, t.seconds])).toEqual([
      ['Beta', 7200],
      ['Alpha', 4200]
    ])
    expect(stats.recent).toHaveLength(2) // the 90-day-old session is outside the window
    expect(stats.top.some((t) => t.id === c.id)).toBe(false)
  })

  it('is empty for a new library', () => {
    expect(playStats(openDatabase(':memory:').db)).toEqual({ totalSeconds: 0, gamesPlayed: 0, sessions: 0, longest: null, top: [], recent: [] })
  })
})
