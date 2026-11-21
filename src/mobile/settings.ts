import { normalizeVoice } from '@shared/voiceSettings'
import { normalizeOverlay } from '@shared/overlay'
import { normalizeInterface } from '@shared/interfaceOptions'
import { DEFAULT_SETTINGS } from '@shared/settingsDefaults'
import type { Settings } from '@shared/types'
import { BUILT_IN_KEYS } from '../main/builtinKeys'

const KEY = 'vanity-settings'
let cache: Settings | null = null

/** Fills in defaults and the built-in API keys, like the desktop app does. */
function withDefaults(stored: Partial<Settings>): Settings {
  const merged: Settings = { ...DEFAULT_SETTINGS, ...stored, enabledSources: { ...DEFAULT_SETTINGS.enabledSources, ...stored.enabledSources }, interface: normalizeInterface(stored.interface), voice: normalizeVoice(stored.voice), overlay: normalizeOverlay(stored.overlay) }
  merged.steamGridDbApiKey ||= BUILT_IN_KEYS.steamGridDbApiKey
  merged.igdbClientId ||= BUILT_IN_KEYS.igdbClientId
  merged.igdbClientSecret ||= BUILT_IN_KEYS.igdbClientSecret
  merged.discordClientId ||= BUILT_IN_KEYS.discordClientId
  return merged
}

export function getSettings(): Settings {
  if (cache) return cache
  let stored: Partial<Settings> = {}
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
  } catch {
    // Unreadable settings: start from defaults.
  }
  cache = withDefaults(stored)
  return cache
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = withDefaults({ ...getSettings(), ...patch })
  cache = next
  // Built-in keys aren't stored, so a build with new keys takes effect.
  const toStore: Partial<Settings> = { ...next }
  for (const k of ['steamGridDbApiKey', 'igdbClientId', 'igdbClientSecret', 'discordClientId'] as const) if (next[k] === BUILT_IN_KEYS[k]) toStore[k] = ''
  localStorage.setItem(KEY, JSON.stringify(toStore))
  return next
}

/** The account server address set in the app (Android has no build-time default). */
export function accountServerUrl(): string {
  return getSettings().accountServerUrl.trim().replace(/\/+$/, '')
}
