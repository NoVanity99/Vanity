import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { PushToTalkHotkey, uiohookName } from '../hotkeys'

class FakeHook extends EventEmitter {
  started = 0
  stopped = 0
  start(): void {
    this.started++
  }
  stop(): void {
    this.stopped++
  }
}

const KEYS = { V: 47, Alt: 56, F13: 91, Backquote: 41, Numpad0: 82 }

function setup() {
  const hook = new FakeHook()
  const changes: boolean[] = []
  const ptt = new PushToTalkHotkey((down) => changes.push(down), () => ({ hook, keys: KEYS }))
  return { hook, changes, ptt }
}

describe('push-to-talk key', () => {
  it('reports the chosen key going down and up once each, however long it is held', () => {
    const { hook, changes, ptt } = setup()
    ptt.configure(true, { kind: 'key', code: 'KeyV', label: 'V' })
    expect(hook.started).toBe(1)
    hook.emit('keydown', { keycode: 47 })
    hook.emit('keydown', { keycode: 47 }) // key repeat while held
    hook.emit('keydown', { keycode: 56 }) // another key
    hook.emit('keyup', { keycode: 47 })
    expect(changes).toEqual([true, false])
  })

  it('works with a mouse side button', () => {
    const { hook, changes, ptt } = setup()
    ptt.configure(true, { kind: 'mouse', button: 4, label: 'Mouse 4' })
    hook.emit('mousedown', { button: 1 })
    hook.emit('mousedown', { button: 4 })
    hook.emit('mouseup', { button: 4 })
    expect(changes).toEqual([true, false])
  })

  it('only listens while push-to-talk is on, and lets go when switched off mid-press', () => {
    const { hook, changes, ptt } = setup()
    ptt.configure(false, { kind: 'key', code: 'KeyV', label: 'V' })
    expect(hook.started).toBe(0)
    ptt.configure(true, { kind: 'key', code: 'KeyV', label: 'V' })
    hook.emit('keydown', { keycode: 47 })
    ptt.configure(false, null)
    expect(changes).toEqual([true, false])
    expect(hook.stopped).toBe(1)
    // A new key replaces the old one.
    ptt.configure(true, { kind: 'key', code: 'AltLeft', label: 'Left Alt' })
    hook.emit('keydown', { keycode: 47 })
    hook.emit('keydown', { keycode: 56 })
    expect(changes).toEqual([true, false, true])
  })

  it('says plainly when the system-wide hook could not load, instead of failing', () => {
    const ptt = new PushToTalkHotkey(() => {}, () => {
      throw new Error('The module was compiled against a different Node.js version')
    })
    ptt.configure(true, { kind: 'key', code: 'KeyV', label: 'V' })
    expect(ptt.status()).toEqual({ global: false, message: 'The push-to-talk key only works while Vanity is in front on this PC (The module was compiled against a different Node.js version).' })
  })

  it('knows the key names', () => {
    expect(['KeyV', 'AltLeft', 'F13', 'Backquote', 'Numpad0', 'Digit4', 'MediaPlayPause'].map(uiohookName)).toEqual(['V', 'Alt', 'F13', 'Backquote', 'Numpad0', '4', null])
  })
})
