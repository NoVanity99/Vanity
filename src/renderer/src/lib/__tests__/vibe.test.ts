import { describe, expect, it } from 'vitest'
import type { Game } from '@shared/types'
import { timeLabel, vibeCheck } from '../vibe'

const NOW = new Date(2026, 9, 26, 20).getTime()
const DAY = 86_400_000
const game = (id: number, name: string, genres: string[], over: Partial<Game> = {}): Game =>
  ({ id, name, genres, hidden: false, missing: false, playtimeSeconds: 0, playStatus: null, userRating: null, favorite: false, lastPlayedAt: null, ...over }) as Game

const library = [
  game(1, 'Stardew Valley', ['Simulator', 'Indie'], { playtimeSeconds: 40 * 3600, lastPlayedAt: NOW - 10 * DAY }),
  game(2, 'Elden Ring', ['Role-playing (RPG)', 'Adventure'], { playtimeSeconds: 80 * 3600, playStatus: 'playing', lastPlayedAt: NOW - DAY }),
  game(3, 'Rocket League', ['Sport', 'Racing'], { playtimeSeconds: 20 * 3600, lastPlayedAt: NOW - 5 * DAY }),
  game(4, 'Hades', ['Roguelike', 'Action'], { playtimeSeconds: 0, playStatus: 'backlog' }),
  game(5, 'Portal 2', ['Puzzle'], { playtimeSeconds: 9 * 3600, playStatus: 'completed', lastPlayedAt: NOW - 400 * DAY }),
  game(6, 'Dropped Thing', ['Simulator'], { playStatus: 'dropped' })
]
const s = (gameId: number, minutes: number, daysAgo: number) => ({ gameId, seconds: minutes * 60, startedAt: NOW - daysAgo * DAY })
const sessions = [s(1, 40, 10), s(1, 50, 12), s(1, 45, 20), s(2, 150, 1), s(2, 180, 3), s(3, 12, 5), s(3, 15, 6), s(3, 10, 8)]

describe('vibeCheck', () => {
  it('picks chill games that fit a short evening', () => {
    const [top] = vibeCheck({ games: library, sessions, minutes: 60, mood: 'chill', now: NOW })
    expect(top.game.name).toBe('Stardew Valley')
    expect(top.typical).toBe(45)
    expect(top.reasons.join(' ')).toMatch(/Chill pick/)
    expect(top.reasons.join(' ')).toMatch(/usually run 45 min/)
    // An RPG that's in progress still isn't a chill pick ahead of chill games.
    const names = vibeCheck({ games: library, sessions, minutes: 60, mood: 'chill', now: NOW }, 6).map((p) => p.game.name)
    expect(names.indexOf('Elden Ring')).toBeGreaterThan(names.indexOf('Stardew Valley'))
  })

  it('suits the time you have', () => {
    expect(vibeCheck({ games: library, sessions, minutes: 15, mood: 'quick', now: NOW })[0].game.name).toBe('Rocket League')
    expect(vibeCheck({ games: library, sessions, minutes: 240, mood: 'story', now: NOW })[0].game.name).toBe('Elden Ring')
  })

  it('finds something new, never suggests dropped games, and ranks finished ones low', () => {
    const picks = vibeCheck({ games: library, sessions, minutes: 60, mood: 'new', now: NOW }, 6)
    expect(picks[0].game.name).toBe('Hades')
    expect(picks.some((p) => p.game.name === 'Dropped Thing')).toBe(false)
    expect(picks.at(-1)!.game.name).toBe('Portal 2')
    expect(picks.every((p) => p.match >= 1 && p.match <= 99)).toBe(true)
  })

  it('shuffles ties with the seed, but stays deterministic', () => {
    const twins = [1, 2, 3, 4, 5].map((i) => game(i, `Twin ${i}`, ['Puzzle']))
    const a = vibeCheck({ games: twins, sessions: [], minutes: 30, mood: 'chill', now: NOW, seed: 1 }).map((p) => p.game.id)
    expect(vibeCheck({ games: twins, sessions: [], minutes: 30, mood: 'chill', now: NOW, seed: 1 }).map((p) => p.game.id)).toEqual(a)
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((seed) => vibeCheck({ games: twins, sessions: [], minutes: 30, mood: 'chill', now: NOW, seed })[0].game.id))
    expect(seeds.size).toBeGreaterThan(1)
  })

  it('labels times', () => {
    expect([15, 60, 120, 240].map(timeLabel)).toEqual(['15 min', '1 hour', '2 hours', 'All night'])
    expect(vibeCheck({ games: [], sessions: [], minutes: 60, mood: 'chill' })).toEqual([])
  })
})
