// Voice preferences, kept with Vanity's other settings on this device (not synced: microphones
// and speakers differ from one device to the next).

/** The push-to-talk key: one keyboard key (by its position, `KeyboardEvent.code`) or a mouse button. */
export type PttBinding = { kind: 'key'; code: string; label: string } | { kind: 'mouse'; button: 3 | 4 | 5; label: string }

export interface PeerVolume {
  /** 0 to 2 (0–200%). */
  volume: number
  /** Muted for you only. */
  muted: boolean
}

export interface VoiceSettings {
  /** '' means the system default. */
  inputDeviceId: string
  outputDeviceId: string
  /** Microphone and overall output volume, 0 to 2. */
  inputVolume: number
  outputVolume: number
  /** 'voice': talk when the microphone hears you. 'ptt': talk while a key is held. */
  inputMode: 'voice' | 'ptt'
  /** How loud you must be to be heard in voice mode, in dB (-100 quiet … 0 loud). */
  sensitivityDb: number
  pttKey: PttBinding | null
  /** Keeps sending this long after the push-to-talk key is let go, so the end of a word isn't cut. */
  pttReleaseMs: number
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
  /** Short sounds when people join or leave and when you mute or deafen. */
  soundEffects: boolean
  /** Per-person volume and mute, by Vanity account id. */
  userVolumes: Record<string, PeerVolume>
}

export const SENSITIVITY_RANGE = { min: -100, max: 0 } as const

export const DEFAULT_VOICE: VoiceSettings = {
  inputDeviceId: '',
  outputDeviceId: '',
  inputVolume: 1,
  outputVolume: 1,
  inputMode: 'voice',
  sensitivityDb: -50,
  pttKey: null,
  pttReleaseMs: 200,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  soundEffects: true,
  userVolumes: {}
}

const num = (v: unknown, min: number, max: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '')

function binding(v: unknown): PttBinding | null {
  if (!v || typeof v !== 'object') return null
  const b = v as Record<string, unknown>
  const label = str(b.label, 40)
  if (b.kind === 'key' && typeof b.code === 'string' && /^[A-Za-z0-9]{1,24}$/.test(b.code)) return { kind: 'key', code: b.code, label: label || b.code }
  if (b.kind === 'mouse' && (b.button === 3 || b.button === 4 || b.button === 5)) return { kind: 'mouse', button: b.button, label: label || `Mouse ${b.button}` }
  return null
}

/** Whatever was stored, as complete settings with only sensible values. */
export function normalizeVoice(stored: unknown): VoiceSettings {
  const v = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const d = DEFAULT_VOICE
  const volumes: Record<string, PeerVolume> = {}
  if (v.userVolumes && typeof v.userVolumes === 'object') {
    for (const [id, pv] of Object.entries(v.userVolumes as Record<string, unknown>).slice(0, 500)) {
      if (!pv || typeof pv !== 'object' || id.length > 100) continue
      const p = pv as Record<string, unknown>
      const entry = { volume: num(p.volume, 0, 2, 1), muted: bool(p.muted, false) }
      // Back to normal is the same as not stored.
      if (entry.volume !== 1 || entry.muted) volumes[id] = entry
    }
  }
  return {
    inputDeviceId: str(v.inputDeviceId),
    outputDeviceId: str(v.outputDeviceId),
    inputVolume: num(v.inputVolume, 0, 2, d.inputVolume),
    outputVolume: num(v.outputVolume, 0, 2, d.outputVolume),
    inputMode: v.inputMode === 'ptt' ? 'ptt' : 'voice',
    sensitivityDb: num(v.sensitivityDb, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max, d.sensitivityDb),
    pttKey: binding(v.pttKey),
    pttReleaseMs: num(v.pttReleaseMs, 0, 2000, d.pttReleaseMs),
    noiseSuppression: bool(v.noiseSuppression, d.noiseSuppression),
    echoCancellation: bool(v.echoCancellation, d.echoCancellation),
    autoGainControl: bool(v.autoGainControl, d.autoGainControl),
    soundEffects: bool(v.soundEffects, d.soundEffects),
    userVolumes: volumes
  }
}

/** A readable name for a key, from `KeyboardEvent.code` (what the push-to-talk recorder shows). */
export function keyLabel(code: string): string {
  const names: Record<string, string> = {
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    MetaLeft: 'Left Windows',
    MetaRight: 'Right Windows',
    Space: 'Space',
    CapsLock: 'Caps Lock',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ScrollLock: 'Scroll Lock',
    NumLock: 'Num Lock',
    PageUp: 'Page Up',
    PageDown: 'Page Down'
  }
  if (names[code]) return names[code]
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad/.test(code)) return `Numpad ${code.slice(6)}`
  return code
}

/** Mouse buttons as the browser numbers them (0 left, 1 middle, 2 right, 3 back, 4 forward) → the names we keep. */
export function mouseBinding(browserButton: number): PttBinding | null {
  if (browserButton === 1) return { kind: 'mouse', button: 3, label: 'Middle mouse' }
  if (browserButton === 3) return { kind: 'mouse', button: 4, label: 'Mouse 4 (back)' }
  if (browserButton === 4) return { kind: 'mouse', button: 5, label: 'Mouse 5 (forward)' }
  return null
}
