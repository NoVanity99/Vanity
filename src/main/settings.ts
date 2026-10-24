import { promises as fs, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { SCAN_SOURCES, type Settings } from '@shared/types'

const DEFAULTS: Settings = {
  steamGridDbApiKey: '',
  igdbClientId: '',
  igdbClientSecret: '',
  customFolders: [],
  enabledSources: Object.fromEntries(SCAN_SOURCES.map((s) => [s, true])) as Settings['enabledSources'],
  ignoredExecutables: []
}

let cache: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Merges stored settings over defaults, so new fields get sensible values. */
function withDefaults(stored: Partial<Settings>): Settings {
  return {
    ...DEFAULTS,
    ...stored,
    enabledSources: { ...DEFAULTS.enabledSources, ...stored.enabledSources }
  }
}

export function getSettings(): Settings {
  if (cache) return cache
  try {
    cache = withDefaults(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    // Missing or corrupt file: start from defaults rather than failing.
    cache = withDefaults({})
  }
  return cache
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = withDefaults({ ...getSettings(), ...patch })
  cache = next
  const file = settingsPath()
  await fs.mkdir(dirname(file), { recursive: true })
  // Write to a temp file and rename, so a crash mid-write cannot corrupt settings.
  await fs.writeFile(`${file}.tmp`, JSON.stringify(next, null, 2))
  await fs.rename(`${file}.tmp`, file)
  return next
}
