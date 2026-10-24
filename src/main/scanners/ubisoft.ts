import { win32 } from 'node:path'
import type { DetectedGame } from '@shared/types'
import { isDirectory } from '../util/fs'
import { pickMainExecutable, prettifyName } from '../util/executables'
import { getValue, readRegistryKeys, type RegistryKey } from '../util/registry'
import { cleanPathValue, UNINSTALL_KEYS } from './registryPaths'
import type { Scanner } from './types'

export const UBISOFT_LAUNCHER_KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher'
export const UBISOFT_INSTALLS_KEY = `${UBISOFT_LAUNCHER_KEY}\\Installs`

export interface UbisoftEntry {
  id: string
  name: string
  installPath: string
}

/** Combines Launcher\Installs\<id> (install folder) with "Uplay Install <id>" uninstall entries (name). */
export function parseUbisoftRegistry(keys: RegistryKey[]): UbisoftEntry[] {
  const installs = keys.find((k) => k.path.toLowerCase() === UBISOFT_INSTALLS_KEY.toLowerCase())
  if (!installs) return []
  const names = new Map<string, string>()
  for (const key of keys) {
    if (!/\\Uninstall$/i.test(key.path)) continue
    for (const sub of key.subkeys) {
      const m = /^Uplay Install (\d+)$/i.exec(sub.name)
      const name = getValue(sub.values, 'DisplayName')
      if (m && name) names.set(m[1], name)
    }
  }
  return installs.subkeys.flatMap((sub) => {
    const installPath = cleanPathValue(getValue(sub.values, 'InstallDir'))
    if (!installPath) return []
    return [{ id: sub.name, name: names.get(sub.name) ?? prettifyName(win32.basename(installPath)), installPath }]
  })
}

export const ubisoftScanner: Scanner = {
  source: 'ubisoft',
  async isAvailable() {
    return (await readRegistryKeys([UBISOFT_LAUNCHER_KEY])).length > 0
  },
  async scan() {
    const entries = parseUbisoftRegistry(await readRegistryKeys([UBISOFT_INSTALLS_KEY, ...UNINSTALL_KEYS]))
    const games: DetectedGame[] = []
    for (const entry of entries) {
      if (!(await isDirectory(entry.installPath))) continue
      games.push({
        source: 'ubisoft',
        externalId: entry.id,
        name: entry.name,
        installPath: entry.installPath,
        executablePath: await pickMainExecutable(entry.installPath, entry.name)
      })
    }
    return games
  }
}
