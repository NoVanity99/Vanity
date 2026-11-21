import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cornerPosition, DEFAULT_OVERLAY, normalizeOverlay, notesWindowSize, OVERLAY_NOTE_MS, voiceWindowSize, type OverlaySettings, type OverlayState } from '../../../shared/overlay'

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }))
const { GameOverlay } = await import('../manager')

const AREA = { x: 0, y: 0, width: 1920, height: 1080 }

/** A stand-in for a window: remembers how it was made and what it was told. */
function fakeWindows() {
  const made: { options: Record<string, unknown>; bounds: { x: number; y: number; width: number; height: number }; destroyed: boolean; calls: string[]; sent: OverlayState[]; kind?: string }[] = []
  const createWindow = (options: Record<string, unknown>) => {
    const w = { options, bounds: { x: options.x as number, y: options.y as number, width: options.width as number, height: options.height as number }, destroyed: false, calls: [] as string[], sent: [] as OverlayState[] }
    made.push(w)
    const handlers: Record<string, () => void> = {}
    return {
      isDestroyed: () => w.destroyed,
      destroy: () => {
        w.destroyed = true
        handlers.closed?.()
      },
      setAlwaysOnTop: (on: boolean, level: string) => w.calls.push(`onTop:${on}:${level}`),
      setIgnoreMouseEvents: (on: boolean) => w.calls.push(`clickThrough:${on}`),
      setVisibleOnAllWorkspaces: () => {},
      setBounds: (b: typeof w.bounds) => (w.bounds = b),
      showInactive: () => w.calls.push('showInactive'),
      once: (name: string, fn: () => void) => name === 'ready-to-show' && fn(),
      on: (name: string, fn: () => void) => (handlers[name] = fn),
      webContents: { on: () => {}, setWindowOpenHandler: () => {}, isLoading: () => false, __w: w }
    } as never
  }
  return { made, createWindow, live: () => made.filter((w) => !w.destroyed) }
}

function setup(over: Partial<OverlaySettings> = {}) {
  const settings = { ...DEFAULT_OVERLAY, ...over }
  const game = { running: false }
  const wins = fakeWindows()
  const overlay = new GameOverlay({
    settings: () => settings,
    gameRunning: () => game.running,
    preload: 'preload.js',
    load: (win, kind) => ((win as never as { webContents: { __w: { kind: string } } }).webContents.__w.kind = kind),
    send: (win, state) => (win as never as { webContents: { __w: { sent: OverlayState[] } } }).webContents.__w.sent.push(state),
    createWindow: wins.createWindow as never,
    area: () => AREA
  })
  return { overlay, settings, game, wins }
}

const ANN = { id: 'a', name: 'Ann', avatar: null, muted: false, deafened: false }
const BEN = { id: 'b', name: 'Ben', avatar: null, muted: true, deafened: false }
const NOTE = { name: 'Ben', avatar: null, action: 'sent you a message', detail: 'gg', kind: 'message' as const }

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

describe('overlay settings and placement', () => {
  it('fills in defaults and refuses nonsense', () => {
    expect(normalizeOverlay(undefined)).toEqual({ enabled: true, voiceCorner: 'top-left', notifications: true, notificationCorner: 'top-right' })
    expect(normalizeOverlay({ enabled: false, voiceCorner: 'middle', notifications: 'yes', notificationCorner: 'bottom-left' })).toEqual({ enabled: false, voiceCorner: 'top-left', notifications: true, notificationCorner: 'bottom-left' })
  })
  it('puts a window in each corner with a margin', () => {
    const size = { width: 200, height: 100 }
    expect(cornerPosition(AREA, size, 'top-left')).toEqual({ x: 16, y: 16 })
    expect(cornerPosition(AREA, size, 'top-right')).toEqual({ x: 1704, y: 16 })
    expect(cornerPosition(AREA, size, 'bottom-left')).toEqual({ x: 16, y: 964 })
    expect(cornerPosition({ x: 1920, y: 0, width: 1280, height: 720 }, size, 'bottom-right')).toEqual({ x: 2984, y: 604 })
  })
})

describe('the in-game overlay', () => {
  it('shows nothing until a game started from Vanity is running, and goes away when it closes', () => {
    const { overlay, game, wins } = setup()
    overlay.setVoice([ANN, BEN])
    expect(overlay.notify(NOTE)).toBe(false)
    expect(wins.made).toHaveLength(0)

    game.running = true
    overlay.refresh()
    expect(overlay.showing()).toEqual(['voice'])
    const voice = wins.live()[0]
    expect(voice.kind).toBe('voice')
    expect(voice.bounds).toEqual({ x: 16, y: 16, ...voiceWindowSize(2) })
    // See-through, above the game, never focused, and every click goes through to the game.
    expect(voice.options).toMatchObject({ transparent: true, frame: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false })
    expect(voice.calls).toEqual(['onTop:true:screen-saver', 'clickThrough:true', 'showInactive'])

    game.running = false
    overlay.refresh()
    expect(wins.live()).toHaveLength(0)
  })

  it('has no voice window when you are not in a room, and follows who joins, leaves and talks', () => {
    const { overlay, game, wins } = setup()
    game.running = true
    overlay.refresh()
    expect(wins.made).toHaveLength(0)

    overlay.setVoice([ANN])
    overlay.setVoice([ANN, BEN])
    const voice = wins.live()[0]
    expect(wins.made).toHaveLength(1)
    expect(voice.bounds.height).toBe(voiceWindowSize(2).height)
    overlay.setSpeaking(['b', 'someone-not-here'])
    expect(voice.sent.at(-1)).toEqual({ corner: 'top-left', members: [ANN, BEN], speaking: ['b'], notes: [] })
    overlay.setVoice([ANN])
    expect(voice.sent.at(-1)).toMatchObject({ members: [ANN], speaking: [] })
    overlay.setVoice([])
    expect(wins.live()).toHaveLength(0)
  })

  it('shows notifications top-right for about five seconds, three at most', () => {
    const { overlay, game, wins } = setup()
    game.running = true
    expect(overlay.notify(NOTE)).toBe(true)
    const notes = wins.live()[0]
    expect(notes.kind).toBe('notes')
    expect(notes.bounds).toEqual({ x: 1920 - 16 - notesWindowSize().width, y: 16, ...notesWindowSize() })
    expect(notes.calls).toContain('clickThrough:true')
    for (const detail of ['2', '3', '4']) overlay.notify({ ...NOTE, detail })
    expect(notes.sent.at(-1)!.notes.map((n) => n.detail)).toEqual(['2', '3', '4'])
    vi.advanceTimersByTime(OVERLAY_NOTE_MS + 10)
    // Nothing left to show: the window is gone, not sitting over the game.
    expect(wins.live()).toHaveLength(0)
  })

  it('obeys the settings: off, notifications off, and the chosen corners', () => {
    const off = setup({ enabled: false })
    off.game.running = true
    off.overlay.setVoice([ANN])
    expect(off.overlay.notify(NOTE)).toBe(false)
    expect(off.overlay.preview({ members: [ANN], note: NOTE })).toBe(false)
    expect(off.wins.made).toHaveLength(0)

    const quiet = setup({ notifications: false, voiceCorner: 'bottom-right' })
    quiet.game.running = true
    quiet.overlay.setVoice([ANN])
    expect(quiet.overlay.notify(NOTE)).toBe(false)
    expect(quiet.overlay.showing()).toEqual(['voice'])
    const size = voiceWindowSize(1)
    expect(quiet.wins.live()[0].bounds).toEqual({ x: 1920 - 16 - size.width, y: 1080 - 16 - size.height, ...size })

    // Changing a setting while playing moves or removes what is showing.
    quiet.settings.voiceCorner = 'top-left'
    quiet.overlay.refresh()
    expect(quiet.wins.live()[0].bounds).toMatchObject({ x: 16, y: 16 })
    quiet.settings.enabled = false
    quiet.overlay.refresh()
    expect(quiet.wins.live()).toHaveLength(0)
  })

  it('moves notifications aside when they share a corner with the voice pictures', () => {
    const { overlay, game, wins } = setup({ notificationCorner: 'top-left' })
    game.running = true
    overlay.setVoice([ANN])
    overlay.notify(NOTE)
    const [voice, notes] = wins.live()
    expect(notes.bounds.x).toBe(voice.bounds.x + voice.bounds.width)
  })

  it('previews without a game for a few seconds', () => {
    const { overlay, wins } = setup()
    expect(overlay.preview({ members: [ANN, BEN], note: NOTE }, 6000)).toBe(true)
    expect(overlay.showing()).toEqual(['voice', 'notes'])
    vi.advanceTimersByTime(6100)
    expect(wins.live()).toHaveLength(0)
    expect(overlay.notify(NOTE)).toBe(false)
  })
})
