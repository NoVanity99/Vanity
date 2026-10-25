import type { Collection } from '@shared/types'
import type { Db } from '../db/database'

const MAX_NAME = 60

export interface CollectionsStore {
  list(): Collection[]
  create(name: string): Collection
  rename(id: number, name: string): Collection | null
  remove(id: number): void
  /** Adds a game to a collection, or takes it out. */
  setMember(collectionId: number, gameId: number, member: boolean): void
}

function cleanName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : ''
  if (!n) throw new Error('Give the collection a name.')
  return n
}

export function createCollectionsStore(db: Db, now: () => number = Date.now): CollectionsStore {
  const q = {
    list: db.prepare<[], { id: number; name: string; created_at: number }>('SELECT id, name, created_at FROM collections ORDER BY name COLLATE NOCASE'),
    get: db.prepare<[number], { id: number; name: string; created_at: number }>('SELECT id, name, created_at FROM collections WHERE id = ?'),
    byName: db.prepare<[string], { id: number }>('SELECT id FROM collections WHERE name = ? COLLATE NOCASE'),
    insert: db.prepare<[string, number]>('INSERT INTO collections (name, created_at) VALUES (?, ?)'),
    rename: db.prepare<[string, number]>('UPDATE collections SET name = ? WHERE id = ?'),
    remove: db.prepare<[number]>('DELETE FROM collections WHERE id = ?'),
    add: db.prepare<[number, number, number]>('INSERT OR IGNORE INTO collection_games (collection_id, game_id, added_at) VALUES (?, ?, ?)'),
    drop: db.prepare<[number, number]>('DELETE FROM collection_games WHERE collection_id = ? AND game_id = ?')
  }
  const toCollection = (r: { id: number; name: string; created_at: number }): Collection => ({ id: r.id, name: r.name, createdAt: r.created_at })

  return {
    list: () => q.list.all().map(toCollection),
    create(name) {
      const n = cleanName(name)
      if (q.byName.get(n)) throw new Error(`You already have a collection called "${n}".`)
      const id = Number(q.insert.run(n, now()).lastInsertRowid)
      return toCollection(q.get.get(id)!)
    },
    rename(id, name) {
      const n = cleanName(name)
      const clash = q.byName.get(n)
      if (clash && clash.id !== id) throw new Error(`You already have a collection called "${n}".`)
      q.rename.run(n, id)
      const row = q.get.get(id)
      return row ? toCollection(row) : null
    },
    remove: (id) => void q.remove.run(id),
    setMember(collectionId, gameId, member) {
      if (!q.get.get(collectionId)) throw new Error('That collection no longer exists.')
      if (member) q.add.run(collectionId, gameId, now())
      else q.drop.run(collectionId, gameId)
    }
  }
}
