import { describe, expect, it } from 'vitest'
import { weightedSample } from '../sample'

describe('weightedSample', () => {
  const games = [
    { id: 'huge', hype: 1000 },
    { id: 'big', hype: 300 },
    { id: 'small', hype: 5 },
    { id: 'tiny', hype: 1 }
  ]

  it('returns distinct items, at most count', () => {
    const pick = weightedSample(games, 3)
    expect(pick).toHaveLength(3)
    expect(new Set(pick).size).toBe(3)
    expect(weightedSample(games, 10)).toHaveLength(4)
  })

  it('favours popular games without always picking the same ones', () => {
    const firsts: Record<string, number> = {}
    for (let i = 0; i < 2000; i++) {
      const [first] = weightedSample(games, 1)
      firsts[first.id] = (firsts[first.id] ?? 0) + 1
    }
    expect(firsts.huge).toBeGreaterThan(firsts.big)
    expect(firsts.big).toBeGreaterThan(firsts.small ?? 0)
    expect(firsts.big).toBeGreaterThan(0) // not deterministic
  })
})
