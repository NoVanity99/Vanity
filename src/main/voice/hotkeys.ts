import type { PttBinding } from '@shared/voiceSettings'

/** What the settings page shows about the push-to-talk hotkey. */
export interface HotkeyStatus {
  /** True: the key works even while a game is in front. */
  global: boolean
  /** Why it doesn't, in plain words (or null). */
  message: string | null
}

/** The few parts of uiohook-napi used here (so it can be replaced in tests). */
export interface KeyHook {
  on(event: 'keydown' | 'keyup', listener: (e: { keycode: number }) => void): unknown
  on(event: 'mousedown' | 'mouseup', listener: (e: { button: unknown }) => void): unknown
  removeAllListeners(): unknown
  start(): void
  stop(): void
}

/** `KeyboardEvent.code` → uiohook's key names. Letters, digits, F-keys and numpad keys follow a pattern. */
const NAMES: Record<string, string> = {
  ControlLeft: 'Ctrl',
  ControlRight: 'CtrlRight',
  AltLeft: 'Alt',
  AltRight: 'AltRight',
  ShiftLeft: 'Shift',
  ShiftRight: 'ShiftRight',
  MetaLeft: 'Meta',
  MetaRight: 'MetaRight',
  Space: 'Space',
  Tab: 'Tab',
  CapsLock: 'CapsLock',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Escape: 'Escape',
  Backquote: 'Backquote',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ScrollLock: 'ScrollLock',
  NumLock: 'NumLock',
  NumpadMultiply: 'NumpadMultiply',
  NumpadAdd: 'NumpadAdd',
  NumpadSubtract: 'NumpadSubtract',
  NumpadDecimal: 'NumpadDecimal',
  NumpadDivide: 'NumpadDivide',
  NumpadEnter: 'NumpadEnter'
}

export function uiohookName(code: string): string | null {
  if (NAMES[code]) return NAMES[code]
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  if (/^Numpad\d$/.test(code)) return code
  return null
}

/**
 * Push-to-talk that works while a game is in front: a system-wide keyboard and mouse hook
 * (uiohook-napi) reports the key going down and up, and `onChange` passes that on to the voice
 * engine in the window. It only runs while push-to-talk is chosen and a key is set.
 *
 * A game running as administrator can't be listened to unless Vanity is too; that's Windows.
 */
export class PushToTalkHotkey {
  private hook: KeyHook | null = null
  private keys: Record<string, number> | null = null
  private running = false
  private down = false
  private binding: PttBinding | null = null
  private loadError: string | null = null

  constructor(
    private onChange: (down: boolean) => void,
    /** Loads uiohook-napi; tests pass a stand-in. */
    private load: () => { hook: KeyHook; keys: Record<string, number> } = () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('uiohook-napi') as { uIOhook: KeyHook; UiohookKey: Record<string, number> }
      return { hook: m.uIOhook, keys: m.UiohookKey }
    }
  ) {}

  status(): HotkeyStatus {
    if (this.loadError) return { global: false, message: `The push-to-talk key only works while Vanity is in front on this PC (${this.loadError}).` }
    if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux') return { global: false, message: 'Push-to-talk keys only work while Vanity is in front here.' }
    return { global: true, message: null }
  }

  /** Follows the settings: runs the hook for push-to-talk with a key set, stops it otherwise. */
  configure(enabled: boolean, binding: PttBinding | null): void {
    this.binding = binding
    if (!enabled || !binding) return this.stop()
    if (!this.hook) {
      try {
        const { hook, keys } = this.load()
        this.hook = hook
        this.keys = keys
      } catch (err) {
        this.loadError = err instanceof Error ? err.message.split('\n')[0].slice(0, 120) : 'the keyboard hook could not load'
        console.warn('[voice] push-to-talk hook unavailable:', err)
        return
      }
      this.hook.on('keydown', (e) => this.key(e.keycode, true))
      this.hook.on('keyup', (e) => this.key(e.keycode, false))
      this.hook.on('mousedown', (e) => this.mouse(e.button, true))
      this.hook.on('mouseup', (e) => this.mouse(e.button, false))
    }
    if (!this.running) {
      try {
        this.hook.start()
        this.running = true
      } catch (err) {
        this.loadError = err instanceof Error ? err.message.slice(0, 120) : 'the keyboard hook could not start'
      }
    }
  }

  private key(keycode: number, down: boolean): void {
    const b = this.binding
    if (!b || b.kind !== 'key' || !this.keys) return
    const name = uiohookName(b.code)
    if (name && this.keys[name] === keycode) this.set(down)
  }

  private mouse(button: unknown, down: boolean): void {
    const b = this.binding
    if (b?.kind === 'mouse' && Number(button) === b.button) this.set(down)
  }

  private set(down: boolean): void {
    // Holding a key repeats "down": only changes are passed on.
    if (down === this.down) return
    this.down = down
    this.onChange(down)
  }

  stop(): void {
    if (this.down) this.set(false)
    if (this.hook && this.running) {
      try {
        this.hook.stop()
      } catch {
        // Already stopped.
      }
    }
    this.running = false
  }
}
