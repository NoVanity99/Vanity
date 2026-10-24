import { isAbsolute, join, relative } from 'node:path'
import type { DetectedGame, Game, GamePatch, GameSource } from '@shared/types'
import type { Db } from '../db/database'

export interface LibraryStore {
  list(): Game[]
  get(id: number): Game | null
  /**
   * Inserts new games and refreshes scanner-owned fields (paths, and the name
   * unless the user renamed it) of known ones. Keyed by source + externalId,
   * so rescans never create duplicates. Re-found games stop being "missing".
   */
  upsert(games: DetectedGame[]): { added: number; updated: number; games: Game[] }
  /** After a successful scan of `source`, flags its games that were not found. Returns how many became missing. */
  markMissing(source: GameSource, foundExternalIds: string[]): number
  setMissing(id: number, missing: boolean): void
  update(id: number, patch: GamePatch): Game | null
  remove(id: number): void
}

interface GameRow {
  id: number
  source: GameSource
  external_id: string
  name: string
  install_path: string | null
  executable_path: string | null
  favorite: number
  hidden: number
  missing: number
  added_at: number
  last_played_at: number | null
  playtime_seconds: number
  description: string | null
  genres: string
  release_date: string | null
  developer: string | null
  cover_path: string | null
  hero_path: string | null
  logo_path: string | null
  icon_path: string | null
}

function parseGenres(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((g) => typeof g === 'string') : []
  } catch {
    return []
  }
}

function toGame(r: GameRow): Game {
  return {
    id: r.id,
    source: r.source,
    externalId: r.external_id,
    name: r.name,
    installPath: r.install_path,
    executablePath: r.executable_path,
    favorite: r.favorite === 1,
    hidden: r.hidden === 1,
    missing: r.missing === 1,
    addedAt: r.added_at,
    lastPlayedAt: r.last_played_at,
    playtimeSeconds: r.playtime_seconds,
    description: r.description,
    genres: parseGenres(r.genres),
    releaseDate: r.release_date,
    developer: r.developer,
    coverPath: r.cover_path,
    heroPath: r.hero_path,
    logoPath: r.logo_path,
    iconPath: r.icon_path
  }
}

export function gameKey(g: Pick<DetectedGame, 'source' | 'externalId'>): string {
  return `${g.source}:${g.externalId}`
}

export function createSqliteStore(db: Db, now: () => number = Date.now): LibraryStore {
  const q = {
    list: db.prepare<[], GameRow>('SELECT * FROM games ORDER BY name COLLATE NOCASE'),
    get: db.prepare<[number], GameRow>('SELECT * FROM games WHERE id = ?'),
    findKey: db.prepare<[string, string], { id: number }>('SELECT id FROM games WHERE source = ? AND external_id = ?'),
    insert: db.prepare(
      `INSERT INTO games (source, external_id, name, install_path, executable_path, added_at, last_seen_at)
       VALUES (@source, @externalId, @name, @installPath, @executablePath, @now, @now)`
    ),
    refresh: db.prepare(
      `UPDATE games SET
         name = CASE WHEN name_locked = 1 THEN name ELSE @name END,
         install_path = @installPath,
         executable_path = CASE WHEN executable_locked = 1 THEN executable_path ELSE @executablePath END,
         missing = 0,
         last_seen_at = @now
       WHERE id = @id`
    ),
    sourceIds: db.prepare<[string], { id: number; external_id: string; missing: number }>(
      'SELECT id, external_id, missing FROM games WHERE source = ?'
    ),
    setMissing: db.prepare<[number, number]>('UPDATE games SET missing = ? WHERE id = ?'),
    remove: db.prepare<[number]>('DELETE FROM games WHERE id = ?')
  }

  const get = (id: number): Game | null => {
    const row = q.get.get(id)
    return row ? toGame(row) : null
  }

  const upsert = db.transaction((detected: DetectedGame[]) => {
    let added = 0
    let updated = 0
    const ids: number[] = []
    const t = now()
    for (const d of detected) {
      const params = {
        source: d.source,
        externalId: d.externalId,
        name: d.name,
        installPath: d.installPath,
        executablePath: d.executablePath,
        now: t
      }
      const existing = q.findKey.get(d.source, d.externalId)
      if (existing) {
        q.refresh.run({ ...params, id: existing.id })
        ids.push(existing.id)
        updated++
      } else {
        ids.push(Number(q.insert.run(params).lastInsertRowid))
        added++
      }
    }
    return { added, updated, ids }
  })

  const markMissing = db.transaction((source: GameSource, found: string[]) => {
    const foundSet = new Set(found)
    let count = 0
    for (const row of q.sourceIds.all(source)) {
      if (!foundSet.has(row.external_id) && row.missing === 0) {
        q.setMissing.run(1, row.id)
        count++
      }
    }
    return count
  })

  return {
    list: () => q.list.all().map(toGame),
    get,
    upsert(detected) {
      const { added, updated, ids } = upsert(detected)
      return { added, updated, games: ids.map(get).filter((g): g is Game => g !== null) }
    },
    markMissing: (source, found) => markMissing(source, found),
    setMissing: (id, missing) => void q.setMissing.run(missing ? 1 : 0, id),
    update(id, patch) {
      const sets: string[] = []
      const params: Record<string, unknown> = { id }
      if (typeof patch.name === 'string' && patch.name.trim()) {
        sets.push('name = @name', 'name_locked = 1')
        params.name = patch.name.trim()
      }
      if (typeof patch.favorite === 'boolean') {
        sets.push('favorite = @favorite')
        params.favorite = patch.favorite ? 1 : 0
      }
      if (typeof patch.executablePath === 'string' && patch.executablePath.trim()) {
        sets.push('executable_path = @executablePath', 'executable_locked = 1')
        params.executablePath = patch.executablePath.trim()
      }
      if (typeof patch.hidden === 'boolean') {
        sets.push('hidden = @hidden')
        params.hidden = patch.hidden ? 1 : 0
      }
      if (sets.length) db.prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = @id`).run(params)
      return get(id)
    },
    remove: (id) => void q.remove.run(id)
  }
}

/** True if `child` is the same folder as `parent` or inside it (case-insensitive, as on Windows). */
export function isSameOrInside(child: string, parent: string): boolean {
  const rel = relative(join(parent).toLowerCase(), join(child).toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
