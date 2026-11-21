import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IPC } from '../../shared/ipc'
import { OVERLAY_MAX_MEMBERS, type OverlayMember, type OverlayNote, type OverlaySettings } from '../../shared/overlay'
import { GameOverlay } from './manager'

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
/** Only small pictures the app made itself (data: addresses), never a link. */
const picture = (v: unknown): string | null => (typeof v === 'string' && v.length < 70_000 && /^data:image\/(png|jpeg|webp);base64,/.test(v) ? v : null)
const KINDS: OverlayNote['kind'][] = ['online', 'playing', 'message', 'voice', 'request']

const member = (m: Partial<OverlayMember> | null | undefined): OverlayMember | null => {
  const id = text(m?.id, 80)
  return id ? { id, name: text(m?.name, 40), avatar: picture(m?.avatar), muted: m?.muted === true, deafened: m?.deafened === true } : null
}

/** What the preview button shows when you're not in a voice room. */
const SAMPLE = {
  members: [
    { id: 'preview-1', name: 'You', avatar: null, muted: false, deafened: false },
    { id: 'preview-2', name: 'A friend', avatar: null, muted: true, deafened: false }
  ],
  note: { name: 'A friend', avatar: null, action: 'sent you a message', detail: 'This is where notifications show while you play.', kind: 'message' as const }
}

/**
 * Makes the in-game overlay and connects it to Vanity's window, which is where the voice room
 * and the notifications live: it tells the overlay who is there, who is talking and what happened.
 */
export function setupOverlay(deps: { settings(): OverlaySettings; gameRunning(): boolean; mainWindow(): BrowserWindow | null }): GameOverlay {
  const overlay = new GameOverlay({
    settings: deps.settings,
    gameRunning: deps.gameRunning,
    preload: join(__dirname, '../preload/index.js'),
    load: (win, kind) => {
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?overlay=${kind}`)
      else void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { overlay: kind } })
    },
    send: (win, state) => win.webContents.send(IPC.overlayPush, state)
  })
  /** Only Vanity's own window may feed the overlay. */
  const fromMain = (e: { sender: Electron.WebContents }): boolean => deps.mainWindow()?.webContents === e.sender

  ipcMain.on(IPC.overlayVoice, (e, members: unknown) => {
    if (!fromMain(e)) return
    overlay.setVoice((Array.isArray(members) ? members.slice(0, OVERLAY_MAX_MEMBERS) : []).map(member).filter((m): m is OverlayMember => !!m))
  })
  ipcMain.on(IPC.overlaySpeaking, (e, ids: unknown) => {
    if (fromMain(e)) overlay.setSpeaking((Array.isArray(ids) ? ids.slice(0, 50) : []).map((id) => text(id, 80)).filter(Boolean))
  })
  ipcMain.handle(IPC.overlayNote, (e, n: Partial<OverlayNote> | null) => {
    if (!fromMain(e) || !n) return false
    return overlay.notify({ name: text(n.name, 40), avatar: picture(n.avatar), action: text(n.action, 120), detail: n.detail ? text(n.detail, 160) : null, kind: KINDS.includes(n.kind as never) ? n.kind! : 'message' })
  })
  ipcMain.handle(IPC.overlayPreview, (e) => fromMain(e) && overlay.preview(SAMPLE))
  // Asked by an overlay window when its page has loaded.
  ipcMain.handle(IPC.overlayState, (e) => {
    const kind = overlay.kindOf(BrowserWindow.fromWebContents(e.sender))
    return kind ? overlay.stateFor(kind) : null
  })
  return overlay
}
