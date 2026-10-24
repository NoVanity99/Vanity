import { join } from 'node:path'
import type { DetectedGame } from '@shared/types'
import { isDirectory, safeReadFile, safeReaddir } from '../util/fs'
import { getValue, readRegistryKeys } from '../util/registry'
import { parseVdf, vdfGet, type VdfObject } from '../util/vdf'
import type { Scanner } from './types'

/** Steam tools that show up as apps but are not games. */
const NON_GAME_APP_IDS = new Set([
  '228980', // Steamworks Common Redistributables
  '250820', // SteamVR
  '1070560', // Steam Linux Runtime
  '1391110', // Steam Linux Runtime - Soldier
  '1628350', // Steam Linux Runtime - Sniper
  '1493710' // Proton Experimental
])
const NON_GAME_NAME = /^(proton\b|steam linux runtime|steamworks common redistributables)/i
const STATE_FULLY_INSTALLED = 4

export async function findSteamRoot(): Promise<string | null> {
  const keys = await readRegistryKeys(['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam'])
  const candidates = [
    ...keys.map((k) => getValue(k.values, 'SteamPath') ?? getValue(k.values, 'InstallPath')),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Steam'),
    'C:\\Program Files (x86)\\Steam'
  ]
  for (const c of candidates) {
    if (c && (await isDirectory(join(c, 'steamapps')))) return join(c) // join() normalizes slashes
  }
  return null
}

/** Library folders listed in libraryfolders.vdf, always including the Steam root. */
export function parseLibraryFolders(vdfText: string, steamRoot: string): string[] {
  const root = parseVdf(vdfText)
  const folders = vdfGet(root, 'libraryfolders') as VdfObject | undefined
  const paths = [steamRoot]
  if (folders && typeof folders === 'object') {
    for (const [key, entry] of Object.entries(folders)) {
      if (!/^\d+$/.test(key)) continue // skip "contentstatsid" etc.
      const p = typeof entry === 'string' ? entry : (vdfGet(entry, 'path') as string | undefined)
      if (typeof p === 'string' && p) paths.push(p)
    }
  }
  const seen = new Set<string>()
  return paths.filter((p) => {
    const k = join(p).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Parses an appmanifest_*.acf file. Returns null for tools, partial installs and malformed files. */
export function parseAppManifest(acfText: string, libraryPath: string): DetectedGame | null {
  const state = vdfGet(parseVdf(acfText), 'AppState')
  if (!state || typeof state !== 'object') return null
  const appId = vdfGet(state, 'appid')
  const name = vdfGet(state, 'name')
  const installDir = vdfGet(state, 'installdir')
  const flags = vdfGet(state, 'StateFlags')
  if (typeof appId !== 'string' || typeof name !== 'string' || typeof installDir !== 'string') return null
  if (NON_GAME_APP_IDS.has(appId) || NON_GAME_NAME.test(name)) return null
  if (typeof flags === 'string' && /^\d+$/.test(flags) && !(Number(flags) & STATE_FULLY_INSTALLED)) return null
  return {
    source: 'steam',
    externalId: appId,
    name,
    installPath: join(libraryPath, 'steamapps', 'common', installDir),
    executablePath: null
  }
}

export async function scanSteamRoot(steamRoot: string): Promise<DetectedGame[]> {
  const vdf = await safeReadFile(join(steamRoot, 'steamapps', 'libraryfolders.vdf'))
  const libraries = vdf ? parseLibraryFolders(vdf, steamRoot) : [steamRoot]
  const games = new Map<string, DetectedGame>()

  for (const library of libraries) {
    const steamapps = join(library, 'steamapps')
    for (const entry of await safeReaddir(steamapps)) {
      if (!entry.isFile() || !/^appmanifest_\d+\.acf$/i.test(entry.name)) continue
      const text = await safeReadFile(join(steamapps, entry.name))
      const game = text ? parseAppManifest(text, library) : null
      if (game && !games.has(game.externalId)) games.set(game.externalId, game)
    }
  }
  return [...games.values()]
}

export const steamScanner: Scanner = {
  source: 'steam',
  async isAvailable() {
    return (await findSteamRoot()) !== null
  },
  async scan() {
    const root = await findSteamRoot()
    return root ? scanSteamRoot(root) : []
  }
}
