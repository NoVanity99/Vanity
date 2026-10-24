import type { ArtworkKind, MetadataStatus } from '@shared/types'
import type { Db } from '../db/database'

const PATH_COLUMN: Record<ArtworkKind, string> = {
  cover: 'cover_path',
  hero: 'hero_path',
  logo: 'logo_path',
  icon: 'icon_path'
}

export interface Details {
  description: string | null
  genres: string[]
  releaseDate: string | null
  developer: string | null
}

/** Database writes for metadata and artwork. */
export function createMetadataRepo(db: Db) {
  const lockedKinds = (id: number): ArtworkKind[] =>
    ((db.prepare('SELECT artwork_locked FROM games WHERE id = ?').pluck().get(id) as string | undefined) ?? '')
      .split(',')
      .filter(Boolean) as ArtworkKind[]

  const writeLocked = (id: number, kinds: ArtworkKind[]): void => {
    db.prepare('UPDATE games SET artwork_locked = ? WHERE id = ?').run([...new Set(kinds)].join(','), id)
  }

  return {
    /** Games that still need fetching: never tried, or the last try failed. */
    pendingIds(): number[] {
      return db.prepare("SELECT id FROM games WHERE metadata_status IN ('pending', 'error') ORDER BY id").pluck().all() as number[]
    },

    idsWithStatus(statuses: MetadataStatus[]): number[] {
      const placeholders = statuses.map(() => '?').join(',')
      return db.prepare(`SELECT id FROM games WHERE metadata_status IN (${placeholders})`).pluck().all(...statuses) as number[]
    },

    allIds(): number[] {
      return db.prepare('SELECT id FROM games ORDER BY id').pluck().all() as number[]
    },

    setMatch(id: number, match: { steamGridDbId: number | null; igdbId: number | null }, locked?: boolean): void {
      db.prepare(
        `UPDATE games SET steamgriddb_id = @sgdb, igdb_id = @igdb${locked === undefined ? '' : ', match_locked = @locked'} WHERE id = @id`
      ).run({ id, sgdb: match.steamGridDbId, igdb: match.igdbId, ...(locked === undefined ? {} : { locked: locked ? 1 : 0 }) })
    },

    /** Writes fetched details unless the user has edited them. */
    setDetails(id: number, d: Details): void {
      db.prepare(
        `UPDATE games SET description = @description, genres = @genres, release_date = @releaseDate, developer = @developer
         WHERE id = @id AND details_locked = 0`
      ).run({ id, description: d.description, genres: JSON.stringify(d.genres), releaseDate: d.releaseDate, developer: d.developer })
    },

    unlockDetails(id: number): void {
      db.prepare('UPDATE games SET details_locked = 0 WHERE id = ?').run(id)
    },

    setArtwork(id: number, kind: ArtworkKind, relPath: string | null, lock: boolean): void {
      db.prepare(`UPDATE games SET ${PATH_COLUMN[kind]} = ? WHERE id = ?`).run(relPath, id)
      const kinds = lockedKinds(id).filter((k) => k !== kind)
      writeLocked(id, lock ? [...kinds, kind] : kinds)
    },

    unlockAllArtwork(id: number): void {
      writeLocked(id, [])
    },

    setStatus(id: number, status: MetadataStatus, error: string | null, at: number): void {
      db.prepare('UPDATE games SET metadata_status = ?, metadata_error = ?, metadata_updated_at = ? WHERE id = ?').run(status, error, at, id)
    }
  }
}

export type MetadataRepo = ReturnType<typeof createMetadataRepo>
