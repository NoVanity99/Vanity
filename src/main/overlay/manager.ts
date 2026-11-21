import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { cornerPosition, notesWindowSize, OVERLAY_MAX_MEMBERS, OVERLAY_MAX_NOTES, OVERLAY_NOTE_MS, sameCornerShift, voiceWindowSize, type OverlayKind, type OverlayMember, type OverlayNote, type OverlaySettings, type OverlayState } from '../../shared/overlay'

export interface OverlayDeps {
  settings(): OverlaySettings
  /** Whether a game started from Vanity is running right now. */
  gameRunning(): boolean
  /** Loads the overlay page into a new window. */
  load(win: BrowserWindow, kind: OverlayKind): void
  preload: string
  /** Sends a window what to draw. */
  send(win: BrowserWindow, state: OverlayState): void
  /** Makes the windows (tests replace it). */
  createWindow?: (options: BrowserWindowConstructorOptions) => BrowserWindow
  area?: () => { x: number; y: number; width: number; height: number }
}

/**
 * The in-game overlay. Two small see-through windows that stay above the game and let every
 * click through to it: one with the people in your voice room, one for notifications. They only
 * exist while a game started from Vanity is running (and the overlay is on), and each only while
 * it has something to show, so nothing sits over the game for no reason.
 *
 * This works over windowed and borderless-fullscreen games. A game in exclusive full screen
 * draws straight to the display and covers every window: showing something there would need
 * code injected into the game's graphics, which Vanity doesn't do.
 */
export class GameOverlay {
  private windows: Partial<Record<OverlayKind, BrowserWindow>> = {}
  private members: OverlayMember[] = []
  private speaking: string[] = []
  private notes: OverlayNote[] = []
  private timers = new Map<number, ReturnType<typeof setTimeout>>()
  private noteId = 1
  /** Shown without a game until this time (the "Show a preview" button in Settings). */
  private previewUntil = 0
  private previewTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private deps: OverlayDeps) {}

  /** Whether the overlay may be on screen at all right now. */
  active(): boolean {
    return this.deps.settings().enabled && (this.deps.gameRunning() || Date.now() < this.previewUntil)
  }

  private notesOn(): boolean {
    return this.active() && this.deps.settings().notifications
  }

  /** The people in your voice room (an empty list when you're not in one). */
  setVoice(members: OverlayMember[]): void {
    this.members = members.slice(0, OVERLAY_MAX_MEMBERS)
    const here = new Set(this.members.map((m) => m.id))
    this.speaking = this.speaking.filter((id) => here.has(id))
    this.refresh()
  }

  setSpeaking(ids: string[]): void {
    const here = new Set(this.members.map((m) => m.id))
    this.speaking = ids.filter((id) => here.has(id))
    this.push('voice')
  }

  /** Shows a notification over the game. False when the overlay isn't showing them right now. */
  notify(note: Omit<OverlayNote, 'id'>): boolean {
    if (!this.notesOn()) return false
    const full = { ...note, id: this.noteId++ }
    // The oldest makes room.
    for (const old of this.notes.slice(0, Math.max(0, this.notes.length + 1 - OVERLAY_MAX_NOTES))) this.dropNote(old.id)
    this.notes = [...this.notes, full]
    this.timers.set(
      full.id,
      setTimeout(() => this.dropNote(full.id), OVERLAY_NOTE_MS)
    )
    this.refresh()
    return true
  }

  private dropNote(id: number): void {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
    this.notes = this.notes.filter((n) => n.id !== id)
    this.refresh()
  }

  /** Shows the overlay for a few seconds without a game, with whoever is in voice (or two examples). */
  preview(sample: { members: OverlayMember[]; note: Omit<OverlayNote, 'id'> }, ms = 6000): boolean {
    if (!this.deps.settings().enabled) return false
    const real = this.members
    this.previewUntil = Date.now() + ms
    if (!real.length) {
      this.members = sample.members.slice(0, OVERLAY_MAX_MEMBERS)
      this.speaking = this.members.slice(0, 1).map((m) => m.id)
    }
    this.notify(sample.note)
    this.refresh()
    if (this.previewTimer) clearTimeout(this.previewTimer)
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null
      this.previewUntil = 0
      if (!real.length) {
        this.members = []
        this.speaking = []
      }
      this.refresh()
    }, ms)
    return true
  }

  /** Call when a game starts or stops, or the settings change: shows, moves or removes the windows. */
  refresh(): void {
    const on = this.active()
    if (!on) {
      // Nothing is kept waiting for the next game.
      for (const id of [...this.timers.keys()]) {
        clearTimeout(this.timers.get(id)!)
        this.timers.delete(id)
      }
      this.notes = []
    }
    this.place('voice', on && this.members.length > 0)
    this.place('notes', this.notesOn() && this.notes.length > 0)
  }

  private place(kind: OverlayKind, wanted: boolean): void {
    const existing = this.windows[kind]
    if (!wanted) {
      if (existing && !existing.isDestroyed()) existing.destroy()
      delete this.windows[kind]
      return
    }
    const s = this.deps.settings()
    const area = (this.deps.area ?? (() => screen.getPrimaryDisplay().bounds))()
    const size = kind === 'voice' ? voiceWindowSize(this.members.length) : notesWindowSize()
    const where = kind === 'voice' ? s.voiceCorner : s.notificationCorner
    const at = cornerPosition(area, size, where)
    if (kind === 'notes') {
      const shift = sameCornerShift(s, this.members.length > 0)
      at.x += where.endsWith('left') ? shift : -shift
    }
    let win = existing && !existing.isDestroyed() ? existing : null
    if (!win) {
      win = (this.deps.createWindow ?? ((o) => new BrowserWindow(o)))({
        ...at,
        ...size,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        // Never takes the keyboard away from the game, and isn't a window you can switch to.
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        title: 'Vanity overlay',
        webPreferences: { preload: this.deps.preload, sandbox: false, contextIsolation: true, backgroundThrottling: false }
      })
      const made = win
      this.windows[kind] = made
      // Above everything that isn't exclusive full screen; clicks and the mouse go straight through.
      made.setAlwaysOnTop(true, 'screen-saver')
      made.setIgnoreMouseEvents(true)
      made.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      made.webContents.on('will-navigate', (e) => e.preventDefault())
      made.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      made.once('ready-to-show', () => {
        if (!made.isDestroyed()) made.showInactive()
      })
      made.webContents.on('did-finish-load', () => this.push(kind))
      made.on('closed', () => {
        if (this.windows[kind] === made) delete this.windows[kind]
      })
      this.deps.load(made, kind)
    } else {
      win.setBounds({ ...at, ...size })
      this.push(kind)
    }
  }

  /** What a window should draw right now (also asked for by the page when it opens). */
  stateFor(kind: OverlayKind): OverlayState {
    const s = this.deps.settings()
    return kind === 'voice' ? { corner: s.voiceCorner, members: this.members, speaking: this.speaking, notes: [] } : { corner: s.notificationCorner, members: [], speaking: [], notes: this.notes }
  }

  kindOf(win: BrowserWindow | null): OverlayKind | null {
    if (!win) return null
    return this.windows.voice === win ? 'voice' : this.windows.notes === win ? 'notes' : null
  }

  private push(kind: OverlayKind): void {
    const win = this.windows[kind]
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) this.deps.send(win, this.stateFor(kind))
  }

  /** Which windows are up (for tests and the settings page). */
  showing(): OverlayKind[] {
    return (['voice', 'notes'] as const).filter((k) => this.windows[k] && !this.windows[k]!.isDestroyed())
  }

  close(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer)
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    for (const k of ['voice', 'notes'] as const) {
      const w = this.windows[k]
      if (w && !w.isDestroyed()) w.destroy()
      delete this.windows[k]
    }
  }
}
