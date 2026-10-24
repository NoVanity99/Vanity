import { promises as fs, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { DEFAULT_FONT } from '@shared/fonts'
import { DEFAULT_THEME } from '@shared/themes'
import { SCAN_SOURCES, type Settings } from '@shared/types'

const DEFAULTS: Settings = {
  steamGridDbApiKey: '',
  igdbClientId: '',
  igdbClientSecret: '',
  customFolders: [],
  enabledSources: Object.fromEntries(SCAN_SOURCES.map((s) => [s, true])) as Settings['enabledSources'],
  ignoredExecutables: [],
  theme: DEFAULT_THEME,
  font: DEFAULT_FONT,
  ambientBackground: true,
  minimizeWhilePlaying: false,
  musicFolder: null,
  musicVolume: 0.5,
  accountServerUrl: '',
  accountToken: '',
  accountUsername: '',
  controllerEnabled: true
}

let cache: Settings | null = null

/** API credentials are encrypted at rest with the OS keystore (DPAPI on Windows) when it is available. */
const SECRET_FIELDS = ['steamGridDbApiKey', 'igdbClientId', 'igdbClientSecret', 'accountToken'] as const
const ENCRYPTED_PREFIX = 'enc:'

function encryptSecrets(settings: Settings): Record<string, unknown> {
  const out: Record<string, unknown> = { ...settings }
  for (const field of SECRET_FIELDS) {
    const value = settings[field]
    // Built-in values stay in the build only, so editing .env.local and rebuilding takes effect.
    if (!value || value === BUILT_IN[field]) out[field] = ''
    else if (safeStorage.isEncryptionAvailable()) {
      out[field] = ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString('base64')
    }
  }
  return out
}

function decryptSecrets(stored: Record<string, unknown>): Partial<Settings> {
  const out: Record<string, unknown> = { ...stored }
  for (const field of SECRET_FIELDS) {
    const value = stored[field]
    if (typeof value !== 'string' || !value.startsWith(ENCRYPTED_PREFIX)) continue
    try {
      out[field] = safeStorage.decryptString(Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64'))
    } catch (err) {
      // E.g. the file was copied from another Windows account. The user has to re-enter the key.
      console.warn(`[settings] could not decrypt ${field}:`, err)
      out[field] = ''
    }
  }
  return out as Partial<Settings>
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

/** Credentials built in at build time from .env.local, used when the Settings field is empty. */
const BUILT_IN: Pick<Settings, (typeof SECRET_FIELDS)[number]> = {
  steamGridDbApiKey: import.meta.env.MAIN_VITE_STEAMGRIDDB_API_KEY?.trim() ?? '',
  igdbClientId: import.meta.env.MAIN_VITE_IGDB_CLIENT_ID?.trim() ?? '',
  igdbClientSecret: import.meta.env.MAIN_VITE_IGDB_CLIENT_SECRET?.trim() ?? '',
  // Never built in: a session belongs to whoever signs in.
  accountToken: ''
}

/** Merges stored settings over defaults, so new fields get sensible values. */
function withDefaults(stored: Partial<Settings>): Settings {
  const merged: Settings = {
    ...DEFAULTS,
    ...stored,
    enabledSources: { ...DEFAULTS.enabledSources, ...stored.enabledSources }
  }
  for (const field of SECRET_FIELDS) merged[field] ||= BUILT_IN[field]
  return merged
}

export function getSettings(): Settings {
  if (cache) return cache
  try {
    cache = withDefaults(decryptSecrets(JSON.parse(readFileSync(settingsPath(), 'utf8'))))
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
  await fs.writeFile(`${file}.tmp`, JSON.stringify(encryptSecrets(next), null, 2))
  await fs.rename(`${file}.tmp`, file)
  return next
}

/** The account server URL: the one set in the app, else the one built in from .env.local. */
export function accountServerUrl(settings: Settings = getSettings()): string {
  return (settings.accountServerUrl || import.meta.env.MAIN_VITE_VANITY_API_URL || '').trim().replace(/\/+$/, '')
}
