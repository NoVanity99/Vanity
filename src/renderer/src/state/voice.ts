import { useEffect, useState } from 'react'
import { DEFAULT_VOICE, type PeerVolume, type VoiceSettings } from '@shared/voiceSettings'
import { VoiceClient, type VoiceSnapshot } from '@/voice/client'
import { saveSettings } from './settings'

/**
 * The one voice engine for the whole app, and React hooks to read it. It lives outside any page,
 * so a call carries on while you browse; the screens only read its snapshot and call its methods.
 */

let settings: VoiceSettings = DEFAULT_VOICE
let serverUrl = ''

/** Per-person volumes are saved a moment after the slider stops, not on every step. */
let volumeTimer: ReturnType<typeof setTimeout> | null = null
let pendingVolumes: Record<string, PeerVolume | null> = {}

export const voice = new VoiceClient({
  serverUrl: () => serverUrl,
  token: async () => {
    const r = await window.vanity.voice.token()
    if (r.error !== undefined) throw new Error(r.error)
    return r.data
  },
  settings: () => settings,
  saveVolume: (userId, volume) => {
    pendingVolumes[userId] = volume
    const userVolumes = { ...settings.userVolumes }
    if (volume) userVolumes[userId] = volume
    else delete userVolumes[userId]
    settings = { ...settings, userVolumes }
    if (volumeTimer) clearTimeout(volumeTimer)
    volumeTimer = setTimeout(() => {
      pendingVolumes = {}
      void saveVoiceSettings({ userVolumes: settings.userVolumes })
    }, 600)
  }
})

/** Keeps the engine's copy of the settings and server address current. Called by the app shell. */
export function syncVoiceSettings(next: VoiceSettings | undefined): void {
  if (!next) return
  // A volume still being saved wins over the older copy coming back.
  const userVolumes = { ...next.userVolumes }
  for (const [id, v] of Object.entries(pendingVolumes)) {
    if (v) userVolumes[id] = v
    else delete userVolumes[id]
  }
  settings = { ...next, userVolumes }
  void window.vanity.voice.serverUrl().then((r) => (serverUrl = r.url), () => {})
  void voice.applySettings()
}

export function voiceSettings(): VoiceSettings {
  return settings
}

/** Applies voice settings at once without saving (a slider being dragged); save with saveVoiceSettings when let go. */
export function previewVoiceSettings(patch: Partial<VoiceSettings>): void {
  settings = { ...settings, ...patch }
  void voice.applySettings()
}

/** Saves some voice settings (and applies them at once). */
export async function saveVoiceSettings(patch: Partial<VoiceSettings>): Promise<void> {
  settings = { ...settings, ...patch }
  void voice.applySettings()
  const saved = await saveSettings({ voice: settings })
  syncVoiceSettings(saved.voice)
}

export function useVoice(): VoiceSnapshot {
  const [snap, setSnap] = useState(voice.snapshot)
  useEffect(() => voice.subscribe(setSnap), [])
  return snap
}

/** Your microphone level in dB, while in a room or testing (−100 otherwise). */
export function useMicLevel(): number {
  const [db, setDb] = useState(-100)
  useEffect(() => voice.onLevel(setDb), [])
  return db
}

// ---- push-to-talk ---------------------------------------------------------------------

let pttWired = false
/**
 * Push-to-talk: the system-wide key from the main process works anywhere (a game in front
 * included). When that hook isn't available, the key still works while Vanity itself is in front.
 */
export function wirePushToTalk(): void {
  if (pttWired) return
  pttWired = true
  window.vanity.voice.onPushToTalk((down) => voice.pushToTalk(down))
  let global = false
  void window.vanity.voice.hotkeyStatus().then((s) => (global = s.global), () => {})
  const matches = (e: KeyboardEvent | MouseEvent): boolean => {
    const b = settings.pttKey
    if (!b || settings.inputMode !== 'ptt') return false
    if (b.kind === 'key') return e instanceof KeyboardEvent && e.code === b.code
    const browser = b.button === 3 ? 1 : b.button === 4 ? 3 : 4
    return e instanceof MouseEvent && e.button === browser
  }
  const typing = (e: Event): boolean => {
    const t = e.target as HTMLElement | null
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  }
  window.addEventListener('keydown', (e) => !global && !e.repeat && matches(e) && !typing(e) && voice.pushToTalk(true))
  window.addEventListener('keyup', (e) => !global && matches(e) && voice.pushToTalk(false))
  window.addEventListener('mousedown', (e) => !global && matches(e) && voice.pushToTalk(true))
  window.addEventListener('mouseup', (e) => !global && matches(e) && voice.pushToTalk(false))
  // Leaving the window with the key held: let go.
  window.addEventListener('blur', () => !global && voice.pushToTalk(false))
}
