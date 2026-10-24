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
import { StatusService } from './status/service'
import { audioResponse, MusicLibrary } from './music/library'
import { LiveService } from './live/service'
import { themeById } from '@shared/themes'
import { getSettings } from './settings'
import { loadWindowState, trackWindowState } from './windowState'
import { secureWebviews } from './steamStoreView'
import icon from '../../resources/icon.png?asset'

let db: Db | null = null
let tracker: SessionTracker | null = null
let metadata: MetadataService | null = null
let trending: TrendingService | null = null
let status: StatusService | null = null

/** Window chrome colours for the current theme. */
function chromeColors(): { bg: string; symbol: string } {
  const { colors } = themeById(getSettings().theme)
  return { bg: colors.bg, symbol: colors.muted }
}

function applyChrome(): void {
  const { bg, symbol } = chromeColors()
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(bg)
    try {
      // Only on platforms with a title bar overlay (Windows).
      win.setTitleBarOverlay({ color: bg, symbolColor: symbol, height: 36 })
    } catch {
      // Not supported here.
    }
  }
}

// Cached artwork is served to the UI as vanity-media://media/<relative path>.
protocol.registerSchemesAsPrivileged([
  { scheme: 'vanity-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // Music for the mini player: vanity-music://track/<index>. Streams with Range support.
  { scheme: 'vanity-music', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
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

secureWebviews()

// Dark native controls (scrollbars, dropdowns, date pickers, dialogs where supported).
nativeTheme.themeSource = 'dark'

function createWindow(): void {
  const saved = loadWindowState()
  const chrome = chromeColors()
  const win = new BrowserWindow({
    ...saved.bounds,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: chrome.bg,
    icon,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: chrome.bg, symbolColor: chrome.symbol, height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // For the embedded Steam store (locked down in steamStoreView.ts).
      webviewTag: true
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

  status = new StatusService({ fetchFn, onUpdate: (s) => broadcast(IPC.statusUpdated, s) })

  const music = new MusicLibrary()
  void music.load(getSettings().musicFolder).catch((err) => console.warn('[music] scan failed:', err))
  protocol.handle('vanity-music', async (request) => {
    const url = new URL(request.url)
    const index = url.hostname === 'track' ? Number(url.pathname.replace(/^\/+/, '')) : NaN
    const file = music.track(index)
    if (!file) return new Response('Not found', { status: 404 })
    try {
      return await audioResponse(file, request.headers.get('range'))
    } catch {
      return new Response('Unreadable', { status: 404 })
    }
  })

  const live = new LiveService({ db, store, fetchFn, getSettings })

  registerIpc({ store, tracker, metadata, media, trending, status, music, live, onSettingsChanged: applyChrome })
  createWindow()
  if (opened.warning) dialog.showMessageBox({ type: 'warning', title: 'Vanity', message: opened.warning })
  // Fetch artwork for games that don't have it yet (or failed last time), in the background.
  metadata.enqueuePending()
  // Keep the Trending list fresh in the background so the tab opens instantly.
  trending.start()
  status.start()

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
  status?.dispose()
  db?.close()
  db = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
