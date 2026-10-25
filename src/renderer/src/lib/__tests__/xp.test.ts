import { describe, expect, it } from 'vitest'
import { gameXp, levelFor, totalXp, xpForLevel } from '../xp'

describe('gamer level', () => {
  it('earns XP from minutes played, finishing and rating', () => {
    expect(gameXp({ playtimeSeconds: 3600, playStatus: null, userRating: null })).toBe(60)
    expect(gameXp({ playtimeSeconds: 0, playStatus: 'beaten', userRating: 4 })).toBe(170)
    expect(gameXp({ playtimeSeconds: 90, playStatus: 'completed', userRating: null })).toBe(301)
    expect(totalXp([{ playtimeSeconds: 600, playStatus: null, userRating: null }, { playtimeSeconds: 0, playStatus: null, userRating: 5 }])).toBe(30)
  })

  it('levels up on a growing curve', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 100, 300, 600, 1000])
    expect(levelFor(0)).toEqual({ level: 1, into: 0, span: 100, title: 'Rookie' })
    expect(levelFor(99).level).toBe(1)
    expect(levelFor(100)).toMatchObject({ level: 2, into: 0, span: 200 })
    expect(levelFor(1050)).toMatchObject({ level: 5, into: 50, span: 500, title: 'Adventurer' })
    expect(levelFor(1_000_000).title).toBe('Mythic')
  })
})
