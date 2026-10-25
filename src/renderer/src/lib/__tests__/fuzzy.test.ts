import { describe, expect, it } from 'vitest'
import { matchScore } from '../fuzzy'

describe('matchScore', () => {
  const rank = (q: string, items: string[]): string[] =>
    items
      .map((t) => [t, matchScore(q, t)] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)

  it('prefers prefixes, then word starts, then substrings, then letters in order', () => {
    const games = ['The Witcher 3: Wild Hunt', 'Witchfire', 'Twitch Simulator', 'Portal 2']
    expect(rank('witch', games)).toEqual(['Witchfire', 'The Witcher 3: Wild Hunt', 'Twitch Simulator'])
    expect(rank('tw3', games)).toEqual(['The Witcher 3: Wild Hunt'])
    expect(rank('pokemon', ['Pokémon Legends'])).toEqual(['Pokémon Legends'])
    expect(matchScore('zzz', 'Portal')).toBe(0)
    expect(matchScore('', 'anything')).toBeGreaterThan(0)
  })
})
