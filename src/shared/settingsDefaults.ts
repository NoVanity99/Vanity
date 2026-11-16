import { DEFAULT_FONT } from './fonts'
import { DEFAULT_INTERFACE } from './interfaceOptions'
import { DEFAULT_VOICE } from './voiceSettings'
import { DEFAULT_THEME } from './themes'
import { SCAN_SOURCES, type Settings } from './types'

/** Settings for a fresh install, on every platform. */
export const DEFAULT_SETTINGS: Settings = {
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
  controllerEnabled: true,
  githubToken: '',
  discordPresence: false,
  discordClientId: '',
  updateKey: '',
  breakReminderMinutes: 0,
  interface: DEFAULT_INTERFACE,
  voice: DEFAULT_VOICE
}
