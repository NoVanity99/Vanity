import { describe, expect, it } from 'vitest'
import type { Game } from '../types'
import { dedupeByName, nameKey } from '../dedupe'

const g = (id: number, name: string, over: Partial<Game> = {}): Game =>
  ({ id, name, source: 'steam', missing: false, hidden: false, favorite: false, playtimeSeconds: 0, ...over }) as Game

describe('no duplicate games', () => {
  it('treats the same title as equal whatever the case, accents or symbols', () => {
    expect(nameKey('Pokémon™: Let’s Go!')).toBe(nameKey('pokemon lets go'))
    expect(nameKey('Ratchet & Clank')).toBe(nameKey('Ratchet and Clank'))
    expect(nameKey('Portal')).not.toBe(nameKey('Portal 2'))
  })

  it('shows one copy per name, keeping the order', () => {
    const list = dedupeByName([g(1, 'Hades', { source: 'epic' }), g(2, 'Celeste'), g(3, 'HADES', { source: 'steam' }), g(4, 'Hades™', { source: 'custom' })])
    expect(list.map((x) => x.id)).toEqual([2, 3]) // Steam's copy wins when nothing else differs
  })

  it('prefers the installed copy, then the one you played most, then your favourite', () => {
    expect(dedupeByName([g(1, 'A', { missing: true, playtimeSeconds: 999 }), g(2, 'A')]).map((x) => x.id)).toEqual([2])
    expect(dedupeByName([g(1, 'A'), g(2, 'A', { source: 'manual', playtimeSeconds: 60 })]).map((x) => x.id)).toEqual([2])
    expect(dedupeByName([g(1, 'A'), g(2, 'A', { source: 'gog', favorite: true })]).map((x) => x.id)).toEqual([2])
    expect(dedupeByName([g(1, 'A', { hidden: true }), g(2, 'A', { source: 'gog' })]).map((x) => x.id)).toEqual([2])
  })

  it('never merges games whose names are only symbols', () => {
    expect(dedupeByName([g(1, '???'), g(2, '!!!')])).toHaveLength(2)
  })

  it('gives the copy shown the latest play of any copy, so it stays in Jump back in', () => {
    const [shown] = dedupeByName([g(1, 'Hades', { lastPlayedAt: null }), g(2, 'Hades', { source: 'custom', missing: true, lastPlayedAt: 5000 })])
    expect([shown.id, shown.lastPlayedAt]).toEqual([1, 5000])
  })
})
