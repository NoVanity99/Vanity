import { join } from 'node:path'
import type { DetectedGame } from '@shared/types'
import { isDirectory, safeReadFile, safeReaddir } from '../util/fs'
import type { Scanner } from './types'

export function epicManifestDir(): string {
  const programData = process.env.ProgramData ?? process.env.PROGRAMDATA ?? 'C:\\ProgramData'
  return join(programData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
}

interface EpicManifest {
  DisplayName?: string
  AppName?: string
  MainGameAppName?: string
  InstallLocation?: string
  LaunchExecutable?: string
  AppCategories?: string[]
  bIsIncompleteInstall?: boolean
}

/** Parses one .item manifest. Returns null for DLC, Unreal Engine/plugins, incomplete installs and bad JSON. */
export function parseEpicManifest(text: string): DetectedGame | null {
  let m: EpicManifest
  try {
    m = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
  if (!m.AppName || !m.DisplayName || !m.InstallLocation) return null
  if (m.bIsIncompleteInstall) return null
  if (m.MainGameAppName && m.MainGameAppName !== m.AppName) return null // DLC
  const categories = (m.AppCategories ?? []).map((c) => c.toLowerCase())
  if (categories.length > 0 && !categories.includes('games')) return null // engines, plugins, assets

  return {
    source: 'epic',
    externalId: m.AppName,
    name: m.DisplayName,
    installPath: join(m.InstallLocation),
    executablePath: m.LaunchExecutable ? join(m.InstallLocation, m.LaunchExecutable) : null
  }
}

export async function scanEpicManifests(dir: string): Promise<DetectedGame[]> {
  const games = new Map<string, DetectedGame>()
  for (const entry of await safeReaddir(dir)) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.item')) continue
    const text = await safeReadFile(join(dir, entry.name))
    const game = text ? parseEpicManifest(text) : null
    if (game && (await isDirectory(game.installPath!))) games.set(game.externalId, game)
  }
  return [...games.values()]
}

export const epicScanner: Scanner = {
  source: 'epic',
  isAvailable: () => isDirectory(epicManifestDir()),
  scan: () => scanEpicManifests(epicManifestDir())
}
