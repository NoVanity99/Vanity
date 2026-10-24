import type { DetectedGame } from '@shared/types'
import { isDirectory } from '../util/fs'
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

export const gogScanner: Scanner = {
  source: 'gog',
  async isAvailable() {
    return (await readRegistryKeys([GOG_GAMES_KEY])).length > 0
  },
  async scan() {
    const [key] = await readRegistryKeys([GOG_GAMES_KEY])
    const games = parseGogRegistry(key)
    const present = await Promise.all(games.map((g) => isDirectory(g.installPath!)))
    return games.filter((_, i) => present[i])
  }
}
