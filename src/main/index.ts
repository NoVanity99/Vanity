import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, nativeTheme, net, Notification, protocol, shell } from 'electron'
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
import { DetailsService } from './details/service'
import { UpdateService } from './update/service'
import { DiscordPresence } from './discord/presence'
import { steamArtworkUrl } from './metadata/steamStore'
import { exec, unzip } from './update/exec'
import { playStats } from './library/stats'
import { AccountService } from './account/service'
import { accountServerUrl, getSettings, updateSettings } from './settings'
import { themeById } from '@shared/themes'
import { loadWindowState, trackWindowState } from './windowState'
import { secureWebviews } from './steamStoreView'
import icon from '../../resources/icon.png?asset'

let db: Db | null = null
let tracker: SessionTracker | null = null
let metadata: MetadataService | null = null
let trending: TrendingService | null = null
let status: StatusService | null = null
let account: AccountService | null = null
let update: UpdateService | null = null
let discord: DiscordPresence | null = null

/** True while Vanity minimised itself for a running game, so it only restores what it hid. */
let minimizedForGame = false

function minimizeWhilePlaying(state: 'launching' | 'running' | 'stopped'): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (state === 'running' && getSettings().minimizeWhilePlaying && !win.isMinimized()) {
    win.minimize()
    minimizedForGame = true
  } else if (state === 'stopped' && minimizedForGame && Object.keys(tracker?.states() ?? {}).length === 0) {
    minimizedForGame = false
    if (win.isMinimized()) win.restore()
  }
}

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
  { scheme: 'vanity-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  // Music for the mini player: vanity-music://track/<index> (streams with Range support) and vanity-music://art/<index>.
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
    // Only web links (news, trailers, store pages); never file: or other schemes.
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
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
    onChange: (gameId, state) => {
      broadcast(IPC.sessionsChanged, { gameId, state })
      minimizeWhilePlaying(state)
      account?.onSessionChange(state)
      showGameOnDiscord()
    }
  })

  const store = createSqliteStore(db)

  discord = new DiscordPresence({
    enabled: () => getSettings().discordPresence,
    clientId: () => getSettings().discordClientId.trim(),
    onStatus: (s) => broadcast(IPC.discordStatusChanged, s)
  })
  const showGameOnDiscord = (): void => {
    const running = tracker?.running()
    const game = running ? store.get(running.id) : null
    discord?.setGame(
      game && running
        ? {
            name: game.name,
            startedAt: running.startedAt,
            // Discord can show an image by URL: Steam's public cover for Steam games, else Vanity's logo.
            imageUrl: game.source === 'steam' && /^\d+$/.test(game.externalId) ? steamArtworkUrl('cover', game.externalId) : null
          }
        : null
    )
  }
  discord.sync()
  // Electron's net.fetch uses Chromium's network stack, so system proxy settings apply.
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => net.fetch(url, init)
  const media = new MediaCache(join(app.getPath('userData'), 'media'), fetchFn)

  protocol.handle('vanity-media', async (request) => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const file = url.hostname === 'media' ? media.resolve(rel) : null
    if (!file) return new Response('Not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(file).toString())
    // Allow the UI to read pixels (game pages tint themselves with the cover's colour).
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, headers })
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
    onUpdate: (state) => broadcast(IPC.trendingUpdated, state),
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, icon }).show()
    }
  })

  status = new StatusService({ fetchFn, onUpdate: (s) => broadcast(IPC.statusUpdated, s) })

  const music = new MusicLibrary()
  void music.load(getSettings().musicFolder).catch((err) => console.warn('[music] scan failed:', err))
  protocol.handle('vanity-music', async (request) => {
    const url = new URL(request.url)
    const index = Number(url.pathname.replace(/^\/+/, ''))
    if (url.hostname === 'art') {
      const art = await music.art(index).catch(() => null)
      return art ? new Response(new Uint8Array(art.data), { headers: { 'Content-Type': art.type, 'Cache-Control': 'max-age=3600' } }) : new Response('Not found', { status: 404 })
    }
    const file = url.hostname === 'track' ? music.track(index) : null
    if (!file) return new Response('Not found', { status: 404 })
    try {
      return await audioResponse(file, request.headers.get('range'))
    } catch {
      return new Response('Unreadable', { status: 404 })
    }
  })

  const live = new LiveService({ db, store, fetchFn, getSettings })
  const details = new DetailsService({ db, store, fetchFn, getSettings, steamAppIdFor: (g) => live.steamAppIdFor(g) })

  account = new AccountService({
    store,
    fetchFn,
    getSettings,
    saveSettings: updateSettings,
    serverUrl: () => accountServerUrl(),
    runningGame: () => tracker?.running() ?? null,
    onChange: (s) => broadcast(IPC.accountChanged, s)
  })
  account.start()

  const devServer = is.dev && !!process.env['ELECTRON_RENDERER_URL']
  update = new UpdateService({
    root: app.getAppPath(),
    fetchFn,
    serverUrl: () => accountServerUrl(),
    getUpdateKey: () => getSettings().updateKey,
    getToken: () => getSettings().githubToken,
    exec,
    unzip,
    tmpDir: app.getPath('temp'),
    isDev: devServer,
    supported: !app.isPackaged,
    onUpdate: (s) => broadcast(IPC.updateChanged, s),
    restart: () => {
      if (devServer) {
        // electron-vite restarts the app when main-process code changed; reload in case only the UI did.
        setTimeout(() => BrowserWindow.getAllWindows().forEach((w) => w.webContents.reloadIgnoringCache()), 2500)
      } else {
        app.relaunch()
        app.quit()
      }
    }
  })
  update.start()

  registerIpc({ store, tracker, metadata, media, trending, status, music, live, details, update, discord, db, account, stats: () => playStats(db!), onSettingsChanged: applyChrome })
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

// Tell friends we've gone offline before quitting (waits at most 1.5 s).
let signedOff = false
app.on('before-quit', (event) => {
  if (signedOff || !account?.state().signedIn) return
  event.preventDefault()
  signedOff = true
  void account.signOffQuickly().finally(() => app.quit())
})

app.on('will-quit', () => {
  // Record playtime up to now for games still running; tracking stops with the app.
  tracker?.stopAll()
  metadata?.dispose()
  trending?.dispose()
  status?.dispose()
  update?.dispose()
  discord?.dispose()
  db?.close()
  db = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
