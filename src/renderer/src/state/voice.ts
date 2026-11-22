import { useEffect, useState } from 'react'
import { DEFAULT_VOICE, type PeerVolume, type VoiceSettings } from '@shared/voiceSettings'
import { VoiceClient, type VoiceSnapshot } from '@/voice/client'
import type { VoiceUpdate, VoiceUser } from '@shared/voiceProtocol'
import { playStreamChime } from '@/lib/chime'
import type { Result } from '@shared/ipc'
import { saveSettings } from './settings'

/**
 * The one voice engine for the whole app, and React hooks to read it. It lives outside any page,
 * so a call carries on while you browse; the screens only read its snapshot and call its methods.
 */

let settings: VoiceSettings = DEFAULT_VOICE

const streamStartListeners = new Set<(member: { id: string; user: VoiceUser }) => void>()
/** Told when someone else in your call starts sharing their screen. */
export function onStreamStart(listener: (member: { id: string; user: VoiceUser }) => void): () => void {
  streamStartListeners.add(listener)
  return () => void streamStartListeners.delete(listener)
}

/** The chat message an invite sends; the chat shows a Join button under it. */
export const VOICE_INVITE_TEXT = '🎧 Join me in voice on Vanity'
export const isVoiceInvite = (text: string): boolean => text.includes('Join me in voice on Vanity')

/** The answer, or an error with the server's words. */
async function data<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p
  if (r.error !== undefined) throw new Error(r.error)
  return r.data
}

/** Per-person volumes are saved a moment after the slider stops, not on every step. */
let volumeTimer: ReturnType<typeof setTimeout> | null = null
let pendingVolumes: Record<string, PeerVolume | null> = {}

export const voice = new VoiceClient({
  api: {
    start: (opts) => data(window.vanity.voice.start(opts)),
    join: (roomId) => data(window.vanity.voice.join(roomId)),
    call: (target) => data(window.vanity.account.request<VoiceUpdate>('POST', '/voice/call', target)),
    leave: async () => void (await data(window.vanity.voice.leave())),
    update: (after) => data(window.vanity.voice.update(after)),
    state: async (s) => void (await data(window.vanity.voice.state(s))),
    signal: async (signals) => void (await data(window.vanity.voice.signal(signals))),
    setRoom: (patch) => data(window.vanity.voice.setRoom(patch)),
    invite: async (userId) => void (await data(window.vanity.voice.invite(userId))),
    pickScreen: (id) => window.vanity.voice.pickScreen(id),
    startScreenAudio: (sourceId) => window.vanity.voice.startScreenAudio(sourceId),
    stopScreenAudio: () => window.vanity.voice.stopScreenAudio(),
    onScreenAudio: (cb) => window.vanity.voice.onScreenAudio(cb),
    onScreenAudioEnded: (cb) => window.vanity.voice.onScreenAudioEnded(cb)
  },
  settings: () => settings,
  onStreamStart: (member) => {
    // The chime here; the note with its Watch button is shown by whoever listens (StreamAlerts).
    if (settings.streamAlert) playStreamChime(settings.streamAlertVolume)
    for (const l of streamStartListeners) l(member)
  },
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

/** Keeps the engine's copy of the settings current. Called by the app shell. */
export function syncVoiceSettings(next: VoiceSettings | undefined): void {
  if (!next) return
  // A volume still being saved wins over the older copy coming back.
  const userVolumes = { ...next.userVolumes }
  for (const [id, v] of Object.entries(pendingVolumes)) {
    if (v) userVolumes[id] = v
    else delete userVolumes[id]
  }
  settings = { ...next, userVolumes }
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
  // Closing Vanity mid-call: leave properly, so friends don't see you there for the next minute.
  window.addEventListener('beforeunload', () => {
    if (voice.inRoom) voice.leave()
  })
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

/**
 * Tells the in-game overlay who is in your voice room and who is talking. The list (with
 * pictures) is only sent when it changes; who is talking is a short list of ids sent as it flips.
 */
export function wireOverlay(): () => void {
  let roster = ''
  let talking = ''
  const send = (s: typeof voice.snapshot): void => {
    const inRoom = s.status === 'in-room' || s.status === 'reconnecting'
    const members = inRoom ? s.members.map((m) => ({ id: m.id, name: m.user.username, avatar: m.user.avatar ?? null, muted: m.muted, deafened: m.deafened })) : []
    const nextRoster = JSON.stringify(members.map((m) => [m.id, m.name, m.muted, m.deafened, m.avatar?.length ?? 0]))
    if (nextRoster !== roster) {
      roster = nextRoster
      window.vanity.overlay.setVoice(members)
    }
    const ids = inRoom ? s.members.filter((m) => m.speaking).map((m) => m.id) : []
    const nextTalking = ids.join(',')
    if (nextTalking !== talking) {
      talking = nextTalking
      window.vanity.overlay.setSpeaking(ids)
    }
  }
  send(voice.snapshot)
  return voice.subscribe(send)
}
