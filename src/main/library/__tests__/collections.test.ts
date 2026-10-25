import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../db/database'
import { createCollectionsStore } from '../collections'
import { createSqliteStore } from '../store'

describe('collections', () => {
  it('creates, fills, renames and deletes collections; games know which they are in', () => {
    const db = openDatabase(':memory:').db
    const games = createSqliteStore(db)
    const cols = createCollectionsStore(db, () => 5)
    const [a, b] = games.upsert([
      { source: 'steam', externalId: '1', name: 'Alpha', installPath: null, executablePath: null },
      { source: 'steam', externalId: '2', name: 'Beta', installPath: null, executablePath: null }
    ]).games
    expect(a.collections).toEqual([])

    const coop = cols.create('  Co-op   nights ')
    const rpg = cols.create('RPGs')
    expect(coop).toEqual({ id: coop.id, name: 'Co-op nights', createdAt: 5 })
    expect(() => cols.create('co-op nights')).toThrow(/already/)
    expect(() => cols.create('   ')).toThrow(/name/)

    cols.setMember(coop.id, a.id, true)
    cols.setMember(coop.id, a.id, true) // twice is fine
    cols.setMember(rpg.id, a.id, true)
    cols.setMember(coop.id, b.id, true)
    expect(games.get(a.id)?.collections.sort()).toEqual([coop.id, rpg.id].sort())
    cols.setMember(coop.id, b.id, false)
    expect(games.get(b.id)?.collections).toEqual([])

    expect(cols.rename(rpg.id, 'Role-playing')?.name).toBe('Role-playing')
    expect(() => cols.rename(rpg.id, 'CO-OP NIGHTS')).toThrow(/already/)
    expect(cols.list().map((c) => c.name)).toEqual(['Co-op nights', 'Role-playing'])

    cols.remove(coop.id)
    expect(games.get(a.id)?.collections).toEqual([rpg.id])
    games.remove(a.id)
    expect(db.prepare('SELECT COUNT(*) FROM collection_games').pluck().get()).toBe(0)
    expect(() => cols.setMember(coop.id, b.id, true)).toThrow(/no longer exists/)
  })
})
