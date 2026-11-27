import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { DetectedGame } from '@shared/types'
import { readInfoPlist, type Plist } from '../mac/plist'
import { isDirectory, safeReaddir } from '../util/fs'
import type { Scanner } from './types'

// Games installed as ordinary Mac apps, in /Applications and ~/Applications (and one folder down,
// where some publishers put theirs). An app counts as a game when its Info.plist says so
// (LSApplicationCategoryType is one of Apple's game categories).
//
// Games that a launcher already knows about (Steam, Epic, GOG) are left to that launcher's
// scanner: their .app has the launcher's marker inside it.

export function applicationFolders(home = homedir()): string[] {
  return ['/Applications', join(home, 'Applications')]
}

/** Apple's categories for games: "public.app-category.games" and every "…-games" one. */
export function isGameCategory(category: unknown): boolean {
  return typeof category === 'string' && /^public\.app-category\.([a-z-]+-)?games$/.test(category.trim().toLowerCase())
}

/** The id Vanity keeps for a Mac app: its bundle id when it has one, else its path. */
export function appExternalId(appPath: string, info: Plist | null): string {
  const id = info?.CFBundleIdentifier
  return typeof id === 'string' && id.trim() ? id.trim() : appPath
}

export function appDisplayName(appPath: string, info: Plist | null): string {
  for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
    const v = info?.[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return basename(appPath, '.app')
}

/** The .app bundles directly in a folder, and in its subfolders (one level). */
export async function listApps(folder: string): Promise<string[]> {
  const found: string[] = []
  for (const e of await safeReaddir(folder)) {
    if (e.name.startsWith('.')) continue
    const full = join(folder, e.name)
    if (e.name.toLowerCase().endsWith('.app')) found.push(full)
    else if (e.isDirectory()) for (const inner of await safeReaddir(full)) if (inner.name.toLowerCase().endsWith('.app')) found.push(join(full, inner.name))
  }
  return found
}

/** True when a launcher's own scanner already covers this app (GOG puts goggame-<id>.info inside). */
async function launcherOwned(appPath: string): Promise<boolean> {
  const resources = await safeReaddir(join(appPath, 'Contents', 'Resources'))
  return resources.some((e) => /^goggame-\d+\.info$/i.test(e.name))
}

export async function scanMacApps(folders: string[]): Promise<DetectedGame[]> {
  const games = new Map<string, DetectedGame>()
  for (const folder of folders) {
    for (const app of await listApps(folder)) {
      const info = await readInfoPlist(app)
      if (!isGameCategory(info?.LSApplicationCategoryType)) continue
      if (await launcherOwned(app)) continue
      const id = appExternalId(app, info)
      if (!games.has(id)) games.set(id, { source: 'macapp', externalId: id, name: appDisplayName(app, info), installPath: app, executablePath: app })
    }
  }
  return [...games.values()]
}

export const macAppsScanner: Scanner = {
  source: 'macapp',
  async isAvailable() {
    if (process.platform !== 'darwin') return false
    for (const f of applicationFolders()) if (await isDirectory(f)) return true
    return false
  },
  async scan() {
    return process.platform === 'darwin' ? scanMacApps(applicationFolders()) : []
  }
}
