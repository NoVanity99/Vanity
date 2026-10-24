import { describe, expect, it } from 'vitest'
import { normalizeTitle, pickBestMatch, titleSimilarity } from '../match'

describe('normalizeTitle', () => {
  it.each([
    ['The Witcher® 3: Wild Hunt – Game of the Year Edition', 'the witcher 3 wild hunt'],
    ["Baldur's Gate 3", 'baldurs gate 3'],
    ['DOOM (2016)', 'doom'],
    ['Hades II', 'hades 2'],
    ['Pokémon™ Legends: Arceus', 'pokemon legends arceus'],
    ['Ratchet & Clank', 'ratchet and clank'],
    ['Disco Elysium - The Final Cut', 'disco elysium the final cut']
  ])('%s → %s', (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected)
  })
})

describe('matching', () => {
  it('scores equal titles as 1 and different sequels low', () => {
    expect(titleSimilarity('Baldurs Gate 3', "Baldur's Gate 3")).toBe(1)
    expect(titleSimilarity('Hades', 'Hades II')).toBeLessThan(0.8)
    expect(titleSimilarity('Hollow Knight', 'Hollow Knight: Silksong')).toBeLessThan(0.8)
  })

  it('picks the exact game over related ones', () => {
    const results = [{ name: 'Hades II' }, { name: 'Hades' }, { name: 'Hades: Battle Out of Hell' }]
    expect(pickBestMatch('Hades', results, (r) => r.name)?.name).toBe('Hades')
  })

  it('tolerates small differences', () => {
    const results = [{ name: 'Stardew Valley' }]
    expect(pickBestMatch('Stardew Valley GOTY', results, (r) => r.name)).not.toBeNull()
    expect(pickBestMatch('StardewValley', results, (r) => r.name)).not.toBeNull()
  })

  it('refuses to guess when nothing is close', () => {
    const results = [{ name: 'Celeste' }, { name: 'Celestial Command' }]
    expect(pickBestMatch('Outer Wilds', results, (r) => r.name)).toBeNull()
    expect(pickBestMatch('Anything', [], (r: { name: string }) => r.name)).toBeNull()
  })
})
