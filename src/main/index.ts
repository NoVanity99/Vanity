import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, nativeTheme, net, protocol, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { openDatabase, type Db } from './db/database'
import { registerIpc } from './ipc'
import { IPC } from '@shared/ipc'
import { listProcessPaths } from './launcher/processes'
import { SessionTracker } from './launcher/tracker'
import { createPlaytimeStore } from './library/playtime'
import { createSqliteStore } from './library/store'
import { MediaCache } from './metadata/mediaCache'
import { createMetadataRepo } from './metadata/repo'
import { MetadataService } from './metadata/service'
import { TrendingService } from './trending/service'
import { getSettings } from './settings'
import { loadWindowState, trackWindowState } from './windowState'
import icon from '../../resources/icon.png?asset'

let db: Db | null = null
let tracker: SessionTracker | null = null
let metadata: MetadataService | null = null
let trending: TrendingService | null = null

// Cached artwork is served to the UI as vanity-media://media/<relative path>.
protocol.registerSchemesAsPrivileged([
  { scheme: 'vanity-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

// Lets tests (and anyone wanting a separate profile) point the app at another data folder.
if (process.env.VANITY_USER_DATA) app.setPath('userData', process.env.VANITY_USER_DATA)

// One instance only: launching Vanity again brings the open window to the front.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

// Dark native controls (scrollbars, dropdowns, date pickers, dialogs where supported).
nativeTheme.themeSource = 'dark'

function createWindow(): void {
  const saved = loadWindowState()
  const win = new BrowserWindow({
    ...saved.bounds,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d12',
    icon,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d12', symbolColor: '#c9ced8', height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  trackWindowState(win)
  win.on('ready-to-show', () => {
    if (saved.maximized) win.maximize()
    win.show()
  })

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
  tracker = new SessionTracker({
    store: createPlaytimeStore(db),
    listProcesses: listProcessPaths,
    onChange: (gameId, state) => broadcast(IPC.sessionsChanged, { gameId, state })
  })

  const store = createSqliteStore(db)
  // Electron's net.fetch uses Chromium's network stack, so system proxy settings apply.
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => net.fetch(url, init)
  const media = new MediaCache(join(app.getPath('userData'), 'media'), fetchFn)

  protocol.handle('vanity-media', (request) => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const file = url.hostname === 'media' ? media.resolve(rel) : null
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  metadata = new MetadataService({
    store,
    repo: createMetadataRepo(db),
    media,
    fetchFn,
    getSettings,
    onProgress: (p) => broadcast(IPC.metadataProgressChanged, p),
    onGameUpdated: (id) => broadcast(IPC.metadataGameUpdated, id)
  })

  trending = new TrendingService({
    db,
    fetchFn,
    getSettings,
    // A launcher counts as installed when Windows has a handler for its URI protocol.
    isProtocolRegistered: (protocol) => app.getApplicationNameForProtocol(`${protocol}://`) !== '',
    openExternal: (url) => shell.openExternal(url),
    onUpdate: (state) => broadcast(IPC.trendingUpdated, state)
  })

  registerIpc({ store, tracker, metadata, media, trending })
  createWindow()
  if (opened.warning) dialog.showMessageBox({ type: 'warning', title: 'Vanity', message: opened.warning })
  // Fetch artwork for games that don't have it yet (or failed last time), in the background.
  metadata.enqueuePending()
  // Keep the Trending list fresh in the background so the tab opens instantly.
  trending.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Log rather than crash on unexpected errors (a scanner bug must never take the app down).
process.on('uncaughtException', (err) => console.error('[main] uncaught exception:', err))
process.on('unhandledRejection', (err) => console.error('[main] unhandled rejection:', err))

app.on('will-quit', () => {
  // Record playtime up to now for games still running; tracking stops with the app.
  tracker?.stopAll()
  metadata?.dispose()
  trending?.dispose()
  db?.close()
  db = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
