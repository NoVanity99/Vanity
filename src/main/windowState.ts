import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, screen, type BrowserWindow, type Rectangle } from 'electron'

interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

const DEFAULT_SIZE = { width: 1400, height: 880 }

function stateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/** True if enough of the window's title area is on some display (monitors can be unplugged between runs). */
function isVisible(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: d }) => {
    const overlapX = Math.min(b.x + b.width, d.x + d.width) - Math.max(b.x, d.x)
    const overlapY = Math.min(b.y + 40, d.y + d.height) - Math.max(b.y, d.y)
    return overlapX >= 200 && overlapY >= 20
  })
}

/** The last saved window size and position, if it still fits on screen. */
export function loadWindowState(): { bounds: Partial<Rectangle>; maximized: boolean } {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8')) as WindowState
    const b = s.bounds
    if ([b.x, b.y, b.width, b.height].every(Number.isFinite) && isVisible(b)) return { bounds: b, maximized: !!s.maximized }
    if (Number.isFinite(b.width) && Number.isFinite(b.height)) return { bounds: { width: b.width, height: b.height }, maximized: !!s.maximized }
  } catch {
    // First run or unreadable: use the default size.
  }
  return { bounds: DEFAULT_SIZE, maximized: false }
}

/** Saves the window's normal (un-maximized) bounds and maximized state as it changes. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
    try {
      writeFileSync(stateFile(), JSON.stringify(state))
    } catch {
      // Not worth bothering the user about.
    }
  }
  const later = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 400)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', save)
}
