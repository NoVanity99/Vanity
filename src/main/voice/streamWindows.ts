import { BrowserWindow, type BrowserWindowConstructorOptions, type WebContents, type WebPreferences } from 'electron'

// Shared screens popped out of Vanity: plain windows of their own (not tied to the main window),
// so they can sit on another monitor, go full screen, and stay while you use the rest of Vanity.
// The voice page opens them (window.open) and puts the live picture in; nothing is loaded in them.

const windows = new Map<string, BrowserWindow>()

/**
 * The pop-out's window. Its web settings must be exactly those of the window opening it (Vanity's):
 * otherwise Electron cuts the link between them, and the live picture can't be put in.
 */
export function streamWindowOptions(opener: BrowserWindow): BrowserWindowConstructorOptions {
  // getLastWebPreferences exists at run time but is missing from Electron's type list.
  const wc = opener.webContents as WebContents & { getLastWebPreferences(): WebPreferences | null }
  const { preload, sandbox, contextIsolation, nodeIntegration } = wc.getLastWebPreferences() ?? {}
  return {
    webPreferences: { preload, sandbox, contextIsolation, nodeIntegration },
    width: 1280,
    height: 760,
    minWidth: 320,
    minHeight: 200,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Vanity stream'
  }
}

export function trackStreamWindow(popup: BrowserWindow, frameName: string): void {
  if (!frameName.startsWith('vanity-stream-')) return
  popup.removeMenu()
  windows.set(frameName, popup)
  // Nothing to browse to from here.
  popup.webContents.on('will-navigate', (e) => e.preventDefault())
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  popup.on('closed', () => {
    if (windows.get(frameName) === popup) windows.delete(frameName)
  })
}

/** Keep a popped-out stream above other windows (games included, unless they're exclusive full screen). */
export function setStreamWindowOnTop(frameName: string, on: boolean): boolean {
  const w = windows.get(frameName)
  if (!w || w.isDestroyed()) return false
  w.setAlwaysOnTop(on, 'floating')
  return true
}

export function closeStreamWindows(): void {
  for (const w of windows.values()) if (!w.isDestroyed()) w.close()
  windows.clear()
}
