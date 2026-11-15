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

/** Epic games installed by Vanity itself (through Legendary) aren't in the Epic Launcher's own list. */
let legendaryInstalled: (() => Promise<DetectedGame[]>) | null = null
export function setLegendaryInstalled(reader: (() => Promise<DetectedGame[]>) | null): void {
  legendaryInstalled = reader
}

async function vanityInstalled(): Promise<DetectedGame[]> {
  const games = legendaryInstalled ? await legendaryInstalled().catch(() => []) : []
  const present: DetectedGame[] = []
  for (const g of games) if (g.installPath && (await isDirectory(g.installPath))) present.push(g)
  return present
}

export const epicScanner: Scanner = {
  source: 'epic',
  isAvailable: async () => (await isDirectory(epicManifestDir())) || (await vanityInstalled()).length > 0,
  scan: async () => {
    const byId = new Map<string, DetectedGame>()
    // The Epic Launcher's entry wins when a game is in both lists.
    for (const g of await vanityInstalled()) byId.set(g.externalId, g)
    for (const g of await scanEpicManifests(epicManifestDir())) byId.set(g.externalId, g)
    return [...byId.values()]
  }
}
