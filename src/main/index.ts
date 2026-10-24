import { join } from 'node:path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { openDatabase, type Db } from './db/database'
import { registerIpc } from './ipc'
import { createSqliteStore } from './library/store'

let db: Db | null = null

// Lets tests (and anyone wanting a separate profile) point the app at another data folder.
if (process.env.VANITY_USER_DATA) app.setPath('userData', process.env.VANITY_USER_DATA)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d12',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d12', symbolColor: '#c9ced8', height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // Open external links in the default browser rather than inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.vanity.launcher')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const opened = openDatabase(join(app.getPath('userData'), 'vanity.db'))
  db = opened.db
  registerIpc(createSqliteStore(db))
  createWindow()
  if (opened.warning) dialog.showMessageBox({ type: 'warning', title: 'Vanity', message: opened.warning })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Log rather than crash on unexpected errors (a scanner bug must never take the app down).
process.on('uncaughtException', (err) => console.error('[main] uncaught exception:', err))
process.on('unhandledRejection', (err) => console.error('[main] unhandled rejection:', err))

app.on('will-quit', () => {
  db?.close()
  db = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
