import { join } from 'node:path'
import type { DetectedGame } from '@shared/types'
import { applicationFolders, listApps } from './macApps'
import { isDirectory, safeReadFile, safeReaddir } from '../util/fs'
import { getValue, readRegistryKeys, type RegistryKey } from '../util/registry'
import { cleanPathValue } from './registryPaths'
import type { Scanner } from './types'

export const GOG_GAMES_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games'

/** Turns the subkeys of HKLM\...\GOG.com\Games into games, skipping DLC. */
export function parseGogRegistry(key: RegistryKey | undefined): DetectedGame[] {
  if (!key) return []
  return key.subkeys.flatMap((sub) => {
    const v = sub.values
    const id = getValue(v, 'gameID') ?? sub.name
    const name = getValue(v, 'gameName') ?? getValue(v, 'GAMENAME')
    const installPath = cleanPathValue(getValue(v, 'path'))
    if (!name || !installPath) return []
    if (getValue(v, 'dependsOn')?.trim()) return [] // DLC entries point at their base game
    return [
      {
        source: 'gog' as const,
        externalId: id,
        name,
        installPath,
        executablePath: cleanPathValue(getValue(v, 'exe'))
      }
    ]
  })
}

/**
 * On a Mac, GOG games are ordinary apps (usually in /Applications) with a goggame-<id>.info file
 * inside them naming the game. The info file is plain JSON. DLC info files name their base game.
 */
export function parseGogInfo(text: string, appPath: string): DetectedGame | null {
  let info: { gameId?: unknown; rootGameId?: unknown; name?: unknown }
  try {
    info = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
  const id = typeof info.gameId === 'string' || typeof info.gameId === 'number' ? String(info.gameId) : null
  if (!id || typeof info.name !== 'string' || !info.name.trim()) return null
  if (info.rootGameId !== undefined && String(info.rootGameId) !== id) return null
  return { source: 'gog', externalId: id, name: info.name.trim(), installPath: appPath, executablePath: appPath }
}

export async function scanMacGog(folders: string[]): Promise<DetectedGame[]> {
  const games = new Map<string, DetectedGame>()
  for (const folder of folders) {
    for (const app of await listApps(folder)) {
      const resources = join(app, 'Contents', 'Resources')
      for (const e of await safeReaddir(resources)) {
        if (!/^goggame-\d+\.info$/i.test(e.name)) continue
        const text = await safeReadFile(join(resources, e.name))
        const game = text ? parseGogInfo(text, app) : null
        if (game && !games.has(game.externalId)) games.set(game.externalId, game)
      }
    }
  }
  return [...games.values()]
}

export const gogScanner: Scanner = {
  source: 'gog',
  async isAvailable() {
    if (process.platform === 'darwin') return (await scanMacGog(applicationFolders())).length > 0 || (await isDirectory('/Applications/GOG Galaxy.app'))
    return (await readRegistryKeys([GOG_GAMES_KEY])).length > 0
  },
  async scan() {
    if (process.platform === 'darwin') return scanMacGog(applicationFolders())
    const [key] = await readRegistryKeys([GOG_GAMES_KEY])
    const games = parseGogRegistry(key)
    const present = await Promise.all(games.map((g) => isDirectory(g.installPath!)))
    return games.filter((_, i) => present[i])
  }
}
