import { basename, join } from 'node:path'
import type { GameCandidate } from '@shared/types'
import { isDirectory, safeReaddir } from '../util/fs'
import { isJunkDirName, isLikelyNotGame, prettifyName, rankExecutables } from '../util/executables'
import type { Scanner } from './types'

const MAX_ALTERNATIVES = 10

/** Stable ID for a game identified only by its executable. */
export function exeExternalId(exePath: string): string {
  return join(exePath).toLowerCase()
}

async function candidateFor(folder: string): Promise<GameCandidate | null> {
  const name = prettifyName(basename(folder))
  const [best, ...rest] = await rankExecutables(folder, name)
  if (!best) return null
  return {
    source: 'custom',
    externalId: exeExternalId(best),
    name,
    installPath: folder,
    executablePath: best,
    alternatives: rest.slice(0, MAX_ALTERNATIVES)
  }
}

/**
 * Scans a user folder for games. If the folder itself contains a game exe it is
 * treated as one game; otherwise each subfolder is treated as a separate game.
 */
export async function scanCustomFolder(root: string): Promise<GameCandidate[]> {
  const entries = await safeReaddir(root)
  const hasOwnExe = entries.some(
    (e) => e.isFile() && e.name.toLowerCase().endsWith('.exe') && !isLikelyNotGame(join(root, e.name), root)
  )
  if (hasOwnExe) {
    const single = await candidateFor(root)
    return single ? [single] : []
  }

  const candidates: GameCandidate[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || isJunkDirName(entry.name) || entry.name.startsWith('.')) continue
    const candidate = await candidateFor(join(root, entry.name))
    if (candidate) candidates.push(candidate)
  }
  return candidates
}

export const customScanner: Scanner = {
  source: 'custom',
  async isAvailable(ctx) {
    return ctx.customFolders.length > 0
  },
  async scan(ctx) {
    const seen = new Map<string, GameCandidate>()
    for (const folder of ctx.customFolders) {
      if (!(await isDirectory(folder))) continue
      for (const c of await scanCustomFolder(folder)) if (!seen.has(c.externalId)) seen.set(c.externalId, c)
    }
    return [...seen.values()]
  }
}
