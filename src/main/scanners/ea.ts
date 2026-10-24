import { join } from 'node:path'
import type { DetectedGame } from '@shared/types'
import { isDirectory, pathExists, safeReadFile } from '../util/fs'
import { isLikelyNotGame, pickMainExecutable } from '../util/executables'
import { getValue, readRegistryKeys, type RegistryKey } from '../util/registry'
import { cleanPathValue, UNINSTALL_KEYS } from './registryPaths'
import type { Scanner } from './types'

const EA_LAUNCHER_KEYS = [
  'HKLM\\SOFTWARE\\Electronic Arts\\EA Desktop',
  'HKLM\\SOFTWARE\\WOW6432Node\\Electronic Arts\\EA Desktop',
  'HKLM\\SOFTWARE\\WOW6432Node\\Origin'
]
/** Older EA/Origin titles register here with an "Install Dir" value. */
const EA_GAME_KEYS = ['HKLM\\SOFTWARE\\WOW6432Node\\EA Games', 'HKLM\\SOFTWARE\\WOW6432Node\\Electronic Arts']

const EA_PUBLISHER = /electronic arts|^ea\b|ea swiss|ea games|respawn|bioware|criterion|codemasters|maxis|popcap|ea digital illusions/i
const EA_UNINSTALLER = /eainstaller|ea desktop|\\origin\\|ealauncher|__installer/i
const NOT_A_GAME = /^(ea app|ea desktop|origin)$|anticheat|anti-cheat|redist|directx|visual c\+\+|ea background|ea overlay/i

export interface EaEntry {
  name: string
  installPath: string
  displayIcon: string | null
}

/** Picks EA games out of the Windows uninstall list and EA's own registry keys. */
export function parseEaRegistry(keys: RegistryKey[]): EaEntry[] {
  const byPath = new Map<string, EaEntry>()
  for (const key of keys) {
    const isUninstall = /\\Uninstall$/i.test(key.path)
    for (const sub of key.subkeys) {
      const v = sub.values
      let name: string | undefined
      let installPath: string | null
      if (isUninstall) {
        const publisher = getValue(v, 'Publisher') ?? ''
        const uninstall = getValue(v, 'UninstallString') ?? ''
        if (!EA_PUBLISHER.test(publisher) && !EA_UNINSTALLER.test(uninstall)) continue
        name = getValue(v, 'DisplayName')
        installPath = cleanPathValue(getValue(v, 'InstallLocation'))
      } else {
        name = getValue(v, 'DisplayName') ?? sub.name
        installPath = cleanPathValue(getValue(v, 'Install Dir') ?? getValue(v, 'InstallDir'))
      }
      if (!name || !installPath || NOT_A_GAME.test(name.trim())) continue
      const id = installPath.toLowerCase()
      // Prefer the uninstall entry: it has the proper display name and icon.
      if (byPath.has(id) && !isUninstall) continue
      byPath.set(id, { name: name.trim(), installPath, displayIcon: cleanPathValue(getValue(v, 'DisplayIcon')) })
    }
  }
  return [...byPath.values()]
}

/** EA installs ship __Installer/installerdata.xml naming the launch exe, e.g. "[HKEY…\Install Dir]bf4.exe". */
export function parseInstallerData(xml: string): string | null {
  for (const match of xml.matchAll(/<filePath>([^<]+)<\/filePath>/gi)) {
    const file = match[1].replace(/^\[[^\]]*\]/, '').trim()
    if (/\.exe$/i.test(file)) return file.replace(/\//g, '\\')
  }
  return null
}

async function resolveExecutable(entry: EaEntry): Promise<string | null> {
  const xml = await safeReadFile(join(entry.installPath, '__Installer', 'installerdata.xml'))
  const fromXml = xml && parseInstallerData(xml)
  if (fromXml) {
    const p = join(entry.installPath, fromXml)
    if (await pathExists(p)) return p
  }
  const icon = entry.displayIcon
  if (icon && /\.exe$/i.test(icon) && !isLikelyNotGame(icon) && (await pathExists(icon))) return icon
  return pickMainExecutable(entry.installPath, entry.name)
}

export const eaScanner: Scanner = {
  source: 'ea',
  async isAvailable() {
    if ((await readRegistryKeys(EA_LAUNCHER_KEYS)).length > 0) return true
    return isDirectory(join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Electronic Arts', 'EA Desktop'))
  },
  async scan() {
    const entries = parseEaRegistry(await readRegistryKeys([...UNINSTALL_KEYS, ...EA_GAME_KEYS]))
    const games: DetectedGame[] = []
    for (const entry of entries) {
      if (!(await isDirectory(entry.installPath))) continue
      games.push({
        source: 'ea',
        externalId: entry.installPath.toLowerCase(),
        name: entry.name,
        installPath: entry.installPath,
        executablePath: await resolveExecutable(entry)
      })
    }
    return games
  }
}
