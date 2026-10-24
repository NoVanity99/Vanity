import { join, relative, isAbsolute } from 'node:path'
import type { DetectedGame, Game } from '@shared/types'

/**
 * Stage 1 keeps the library in memory so scanning can be tested on its own.
 * Stage 2 replaces this with a SQLite-backed store with the same interface.
 */
export interface LibraryStore {
  list(): Game[]
  /** Inserts new games and refreshes scanner-owned fields of known ones. Keyed by source + externalId. */
  upsert(games: DetectedGame[]): { added: number; updated: number; games: Game[] }
}

export function gameKey(g: Pick<DetectedGame, 'source' | 'externalId'>): string {
  return `${g.source}:${g.externalId}`
}

export function createMemoryStore(): LibraryStore {
  const games = new Map<string, Game>()
  let nextId = 1

  return {
    list: () => [...games.values()],
    upsert(detected) {
      let added = 0
      let updated = 0
      const result: Game[] = []
      for (const d of detected) {
        const key = gameKey(d)
        const existing = games.get(key)
        if (existing) {
          Object.assign(existing, {
            name: d.name,
            installPath: d.installPath,
            executablePath: d.executablePath
          })
          updated++
          result.push(existing)
        } else {
          const game: Game = {
            ...d,
            id: nextId++,
            favorite: false,
            hidden: false,
            addedAt: Date.now(),
            lastPlayedAt: null,
            playtimeSeconds: 0,
            description: null,
            genres: [],
            releaseDate: null,
            developer: null,
            coverPath: null,
            heroPath: null,
            logoPath: null,
            iconPath: null
          }
          games.set(key, game)
          added++
          result.push(game)
        }
      }
      return { added, updated, games: result }
    }
  }
}

/** True if `child` is the same folder as `parent` or inside it (case-insensitive, as on Windows). */
export function isSameOrInside(child: string, parent: string): boolean {
  const rel = relative(join(parent).toLowerCase(), join(child).toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
