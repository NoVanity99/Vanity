import { describe, expect, it } from 'vitest'
import type { Game } from '@shared/types'
import { computeWrapped } from '../wrapped'

const game = (id: number, name: string, genres: string[]): Game => ({ id, name, genres }) as Game
const at = (m: number, d: number, h: number): number => new Date(2026, m, d, h).getTime()

describe('computeWrapped', () => {
  it('sums the last year: top games, genre, month, habits and records', () => {
    const games = [game(1, 'Hades', ['Roguelike', 'Action']), game(2, 'Stardew', ['Simulator']), game(3, 'Old', ['Puzzle'])]
    const sessions = [
      { gameId: 3, startedAt: at(0, 1, 12) - 400 * 86_400_000, seconds: 9999 }, // over a year ago: ignored
      { gameId: 3, startedAt: at(2, 1, 12), seconds: 600 }, // Old was first played before: not "new"
      { gameId: 1, startedAt: at(8, 1, 23), seconds: 7200 },
      { gameId: 1, startedAt: at(8, 2, 23), seconds: 3600 },
      { gameId: 1, startedAt: at(8, 3, 1), seconds: 1800 },
      { gameId: 2, startedAt: at(9, 4, 7), seconds: 3600 }
    ]
    const w = computeWrapped(sessions, games, at(9, 25, 12))
    expect(w).toMatchObject({ totalSeconds: 16800, sessions: 5, daysPlayed: 5, gamesPlayed: 3, longestStreak: 3, newGames: 2 })
    expect(w.topGames.map((t) => [t.game.name, t.seconds])).toEqual([
      ['Hades', 12600],
      ['Stardew', 3600],
      ['Old', 600]
    ])
    expect(w.topGenre).toMatchObject({ name: 'Roguelike', seconds: 12600 })
    expect(w.busiestMonth?.seconds).toBe(12600)
    expect(w.nightOwl).toBeCloseTo(3 / 5)
    expect(w.earlyBird).toBeCloseTo(1 / 5)
    expect(w.longestSession).toMatchObject({ seconds: 7200, game: { name: 'Hades' } })
  })

  it('is empty without play', () => {
    expect(computeWrapped([], [])).toMatchObject({ totalSeconds: 0, topGames: [], topGenre: null, longestSession: null, busiestWeekday: null })
  })
})
