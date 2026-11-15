import { BrowserWindow, session, shell } from 'electron'
import { dirname } from 'node:path'
import type { Game } from '@shared/types'
import { GAME_PARTITION, GAME_SCHEME, GameWindowHandle, gameFileResponse, gameIdFromHost, gameUrl } from './htmlGame'

/** Permissions a web game may use; anything else (camera, location, notifications…) is refused. */
const ALLOWED = new Set(['fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write'])

/**
 * Runs web games (an .html file) in their own window. The page is served from
 * its folder over vanity-game://game-<id>/, not file://, so engines that load
 * files with fetch (Phaser, Godot, Unity WebGL, Construct…) work, and each game
 * keeps its own saves. The window is sandboxed and can't reach Vanity or the
 * rest of your files; links to websites open in your browser.
 */
export class GameWindows {
  private roots = new Map<number, string>()
  private windows = new Map<number, { win: BrowserWindow; handle: GameWindowHandle }>()

  constructor(private icon: string) {}

  /** Call once the app is ready. */
  register(): void {
    const ses = session.fromPartition(GAME_PARTITION)
    ses.protocol.handle(GAME_SCHEME, (request) => {
      const url = new URL(request.url)
      const id = gameIdFromHost(url.hostname)
      const root = id === null ? undefined : this.roots.get(id)
      if (!root) return new Response('Not found', { status: 404 })
      return gameFileResponse(root, url.pathname, request.headers.get('range'))
    })
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED.has(permission)))
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission))
  }

  /** Closes the game's window, if it is open. */
  close(gameId: number): void {
    const entry = this.windows.get(gameId)
    if (entry && !entry.win.isDestroyed()) entry.win.destroy()
  }

  /** Opens the game (or brings its window to the front if it's already open). The handle emits 'exit' when it closes. */
  open(game: Game, htmlPath: string): GameWindowHandle {
    const existing = this.windows.get(game.id)
    if (existing && !existing.win.isDestroyed()) {
      if (existing.win.isMinimized()) existing.win.restore()
      existing.win.focus()
      return existing.handle
    }

    this.roots.set(game.id, dirname(htmlPath))
    const handle = new GameWindowHandle()
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 480,
      minHeight: 320,
      title: game.name,
      icon: this.icon,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        partition: GAME_PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        // Keep the game running at full speed even when the window is behind another one.
        backgroundThrottling: false
      }
    })
    win.removeMenu()
    this.windows.set(game.id, { win, handle })
    win.once('ready-to-show', () => win.show())
    // Keep the game's name as the window title, whatever the page calls itself.
    win.on('page-title-updated', (e) => e.preventDefault())
    win.on('closed', () => {
      this.windows.delete(game.id)
      handle.emit('exit')
    })

    const wc = win.webContents
    const ownHost = `game-${game.id}`
    const isOwn = (target: string): boolean => {
      try {
        const u = new URL(target)
        return u.protocol === `${GAME_SCHEME}:` && u.hostname === ownHost
      } catch {
        return false
      }
    }
    const openOutside = (target: string): void => {
      if (/^https?:\/\//i.test(target)) void shell.openExternal(target)
    }
    // Pop-ups and links away from the game open in the browser instead.
    wc.setWindowOpenHandler(({ url }) => {
      openOutside(url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (e, url) => {
      if (isOwn(url)) return
      e.preventDefault()
      openOutside(url)
    })
    // F11: full screen.
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        e.preventDefault()
        win.setFullScreen(!win.isFullScreen())
      }
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return // -3: aborted (e.g. a redirect), not a failure
      void wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorPage(game.name, `${description} (${url})`))}`)
    })

    void win.loadURL(gameUrl(game.id, htmlPath))
    return handle
  }

  /** Closes every game window (Vanity is quitting). */
  closeAll(): void {
    for (const { win } of this.windows.values()) if (!win.isDestroyed()) win.close()
  }
}

function errorPage(name: string, detail: string): string {
  const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<!doctype html><title>${esc(name)}</title><body style="background:#0b0d12;color:#e8ebf1;font-family:'Segoe UI',system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:32rem;text-align:center"><h1 style="font-size:1.4rem">${esc(name)} couldn't be opened</h1><p style="color:#8a91a0">${esc(detail)}</p><p style="color:#8a91a0">Check that the game's files are still in the same folder.</p></div></body>`
}
