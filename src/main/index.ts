import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setupOverlay } from './overlay/setup'
import { setMacMenu } from './mac/menu'
import type { GameOverlay } from './overlay/manager'
import { app, ipcMain, BrowserWindow, dialog, globalShortcut, Menu, nativeTheme, net, Notification, protocol, shell, Tray } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { openDatabase, type Db } from './db/database'
import { registerIpc } from './ipc'
import { IPC } from '@shared/ipc'
import { listProcessPaths } from './launcher/processes'
import { SessionTracker } from './launcher/tracker'
import { createPlaytimeStore } from './library/playtime'
import { createSqliteStore } from './library/store'
import { createCollectionsStore } from './library/collections'
import { MediaCache } from './metadata/mediaCache'
import { createMetadataRepo } from './metadata/repo'
import { MetadataService } from './metadata/service'
import { TrendingService } from './trending/service'
import { StatusService } from './status/service'
import { audioResponse, MusicLibrary } from './music/library'
import { AudioConverter, bundledFfmpeg, needsConversion } from './music/convert'
import { LiveService } from './live/service'
import { DetailsService } from './details/service'
import { UpdateService } from './update/service'
import { ReleaseUpdater, type Updater } from './update/release'
import { autoUpdater } from 'electron-updater'
import { DiscordPresence } from './discord/presence'
import { BreakReminders } from './launcher/breaks'
import { GameWindows } from './launcher/gameWindows'
import { GAME_SCHEME } from './launcher/htmlGame'
import { steamArtworkUrl } from './metadata/steamStore'
import { exec, unzip } from './update/exec'
import { playStats } from './library/stats'
import { AccountService } from './account/service'
import { SyncService } from './sync/service'
import { SteamService } from './steam/service'
import { OwnedGames, steamOwnedEntries } from './library/owned'
import { Installers, SteamClientInstaller } from './install/installer'
import { InstallWatcher } from './install/watcher'
import { Legendary } from './downloads/legendary'
import { Gog } from './downloads/gog'
import { EpicDriver, GogDriver } from './downloads/drivers'
import { DownloadManager, freeSpaceOn } from './downloads/manager'
import { StoreAccountsService } from './downloads/accounts'
import { createGogVault, epicLoginWindow, gogLoginWindow, killTree, legendaryBinary, runToEnd } from './downloads/desktop'
import { setLegendaryInstalled } from './scanners/epic'
import { spawn } from 'node:child_process'
import { appendFile, mkdir, stat, rename } from 'node:fs/promises'
import { homedir } from 'node:os' 
import { createKv } from './db/kv'
import { runScan } from './library/scan'
import { scanners } from './scanners'
import { tracked } from './sync/track'
import { createSessionVault, nodeAuthHttp } from './account/desktop'
import { backendConfig } from '@shared/backend'
import { PushToTalkHotkey } from './voice/hotkeys'
import { setupScreenShare } from './voice/screen'
import { stopScreenAudio } from './voice/screenAudio'
import { closeStreamWindows, streamWindowOptions, trackStreamWindow } from './voice/streamWindows'
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
let sync: SyncService | null = null
let steam: SteamService | null = null
let downloads: DownloadManager | null = null
let update: Updater | null = null
let discord: DiscordPresence | null = null
let breaks: BreakReminders | null = null
let gameWindows: GameWindows | null = null
let pushToTalk: PushToTalkHotkey | null = null
let overlay: GameOverlay | null = null
/** Vanity's own window (game windows for web games are separate). */
let mainWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** True while Vanity minimised itself for a running game, so it only restores what it hid. */
let minimizedForGame = false

function minimizeWhilePlaying(state: 'launching' | 'running' | 'stopped'): void {
  const win = getMainWindow()
  if (!win) return
  if (state === 'running' && getSettings().minimizeWhilePlaying && !win.isMinimized()) {
    win.minimize()
    minimizedForGame = true
  } else if (state === 'stopped' && minimizedForGame && Object.keys(tracker?.states() ?? {}).length === 0) {
    minimizedForGame = false
    if (win.isMinimized()) win.restore()
  }
}

const IS_MAC = process.platform === 'darwin'

/** Window chrome colours for the current theme. */
function chromeColors(): { bg: string; symbol: string } {
  const { colors } = themeById(getSettings().theme)
  return { bg: colors.bg, symbol: colors.muted }
}

function applyChrome(): void {
  const { bg, symbol } = chromeColors()
  const win = getMainWindow()
  if (win) {
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
  { scheme: 'vanity-music', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // Pictures and files sent in Channels: vanity-file://f/files/<id>/<token>/<name>, fetched from Vanity's server.
  { scheme: 'vanity-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // Web games added with "Add a game": vanity-game://game-<id>/… serves the game's folder (see launcher/gameWindows.ts).
  { scheme: GAME_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

/** Sends to Vanity's own window only (never to a web game's window). */
function broadcast(channel: string, payload: unknown): void {
  getMainWindow()?.webContents.send(channel, payload)
}

// Lets tests (and anyone wanting a separate profile) point the app at another data folder.
if (process.env.VANITY_USER_DATA) app.setPath('userData', process.env.VANITY_USER_DATA)
// `Vanity.exe --profile=friend` runs a second, separate copy (its own sign-in, library and
// settings), e.g. to try voice rooms with two accounts on one PC. Each profile is one window.
{
  const profile = process.argv.find((a) => a.startsWith('--profile='))?.slice('--profile='.length).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  if (profile && !process.env.VANITY_USER_DATA) app.setPath('userData', `${app.getPath('userData')}-${profile}`)
}

// Mac: caches in ~/Library/Caches/Vanity and logs in ~/Library/Logs/Vanity, as Mac apps keep
// them (Electron's own "logs" path is that folder). Windows keeps everything where it was.
const cacheDir = (): string => (IS_MAC ? join(app.getPath('home'), 'Library', 'Caches', basename(app.getPath('userData'))) : app.getPath('userData'))
const logsDir = (): string => (IS_MAC ? app.getPath('logs') : join(app.getPath('userData'), 'logs'))

// "Keep running in the background": closing the window only hides it. Vanity stays reachable from
// its icon next to the clock (click to open, right-click to quit), so calls, notifications and
// downloads carry on. Settings → Appearance switches it off; then closing the window quits.
let quitting = false
let tray: Tray | null = null
let toldAboutBackground = false
app.on('before-quit', () => (quitting = true))

function showMainWindow(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** The icon next to the clock is there exactly while the setting is on. */
function syncTray(): void {
  // A Mac app stays in the Dock when its window is closed: no icon by the clock needed.
  if (IS_MAC) return
  const wanted = getSettings().closeToBackground
  if (!wanted) {
    tray?.destroy()
    tray = null
    // Nothing to come back from: a hidden window is shown again.
    const win = getMainWindow()
    if (win && !win.isVisible()) win.show()
    return
  }
  if (tray) return
  try {
    tray = new Tray(icon)
    tray.setToolTip('Vanity')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Vanity', click: showMainWindow },
        { type: 'separator' },
        { label: 'Quit Vanity', click: () => app.quit() }
      ])
    )
    tray.on('click', showMainWindow)
    tray.on('double-click', showMainWindow)
  } catch (err) {
    // No place for an icon on this system: closing the window quits as before.
    console.warn('[tray] could not make the icon:', err)
    tray = null
  }
}

// One instance only: launching Vanity again brings the open window to the front.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  showMainWindow()
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
    // Windows: Vanity's own title strip with Windows' buttons drawn over it. Mac: the traffic
    // lights, inset into Vanity's top-left corner (the layout leaves room for them).
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 13 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: chrome.bg, symbolColor: chrome.symbol, height: 36 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // Calls ringing, coins arriving and voice keep their timing while the window is hidden or behind a game.
      backgroundThrottling: false,
      // For the embedded Steam store (locked down in steamStoreView.ts).
      webviewTag: true
    }
  })

  mainWindow = win
  syncTray()
  win.on('close', (event) => {
    // Mac: closing a window never quits; the app stays in the Dock (⌘Q quits) and a click on the
    // Dock icon brings the window back.
    if (IS_MAC) {
      if (quitting) return
      event.preventDefault()
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => win.hide())
        win.setFullScreen(false)
      } else win.hide()
      return
    }
    // Really closing: quitting, an update, or the setting is off (or there is no icon to come back from).
    if (quitting || !getSettings().closeToBackground || !tray) return
    event.preventDefault()
    win.hide()
    if (!toldAboutBackground && Notification.isSupported()) {
      toldAboutBackground = true
      new Notification({ title: 'Vanity is still running', body: 'Find it by the clock: click the icon to open it, right-click to quit. You can change this in Settings → Appearance.', icon }).show()
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  trackWindowState(win)
  win.on('ready-to-show', () => {
    if (saved.maximized) win.maximize()
    win.show()
  })

  // Open external links in the default browser rather than inside the app.
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // A friend's shared screen, popped out into its own window (the voice page fills it in).
    if (url === 'about:blank' && /^vanity-stream-[\w-]{1,80}$/.test(frameName)) {
      return { action: 'allow', overrideBrowserWindowOptions: streamWindowOptions(win) }
    }
    // Only web links (news, trailers, store pages); never file: or other schemes.
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('did-create-window', (popup, details) => trackStreamWindow(popup, details.frameName))
  win.on('closed', () => {
    closeStreamWindows()
    // The voice room lived in that window.
    overlay?.setVoice([])
    overlay?.close()
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
      // The overlay is only up while a game started from Vanity runs.
      overlay?.refresh()
      // A finished session is new progress: save it to the cloud.
      if (state === 'stopped') sync?.touch()
      showGameOnDiscord()
    }
  })

  const store = createSqliteStore(db)
  gameWindows = new GameWindows(icon)
  gameWindows.register()

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

  breaks = new BreakReminders({
    running: () => tracker?.running() ?? null,
    gameName: (id) => store.get(id)?.name ?? null,
    intervalMinutes: () => getSettings().breakReminderMinutes,
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, icon }).show()
    }
  })
  breaks.start()
  // Electron's net.fetch uses Chromium's network stack, so system proxy settings apply.
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => net.fetch(url, init)
  const media = new MediaCache(join(cacheDir(), 'media'), fetchFn)

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

  // Pictures and files in Channels come from Vanity's server and nowhere else: only addresses
  // shaped like a file's are passed on.
  protocol.handle('vanity-file', async (request) => {
    const url = new URL(request.url)
    const api = backendConfig({ authUrl: import.meta.env.MAIN_VITE_NEON_AUTH_URL, apiUrl: import.meta.env.MAIN_VITE_VANITY_BACKEND_URL }).apiUrl
    if (!api || url.hostname !== 'f' || !/^\/files\/[\w-]{8,60}\/[\w-]{8,80}(\/[^/]{0,400})?$/.test(url.pathname)) return new Response('Not found', { status: 404 })
    try {
      return await net.fetch(api + url.pathname)
    } catch {
      return new Response('Offline', { status: 503 })
    }
  })
  ipcMain.handle(IPC.accountFileBases, () => ({ show: 'vanity-file://f', open: backendConfig({ authUrl: import.meta.env.MAIN_VITE_NEON_AUTH_URL, apiUrl: import.meta.env.MAIN_VITE_VANITY_BACKEND_URL }).apiUrl }))

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

  // Formats the player can't decode (WMA, Apple Lossless, AIFF…) are converted with the bundled ffmpeg.
  const converter = new AudioConverter(bundledFfmpeg(), join(cacheDir(), 'music-cache'))
  const music = new MusicLibrary(converter.available)
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
      // ?convert=1: the player couldn't decode the file as it is, so convert it (see MusicPlayer).
      const convert = converter.available && (needsConversion(file) || url.searchParams.get('convert') === '1')
      return await audioResponse(convert ? await converter.convert(file) : file, request.headers.get('range'))
    } catch {
      return new Response('Unreadable', { status: 404 })
    }
  })

  // Push-to-talk from anywhere: the key's ups and downs go to the voice engine in the window.
  // The overlay is for Windows (a Mac's full-screen games live in their own Space): elsewhere it stays off.
  overlay = setupOverlay({ settings: () => (IS_MAC ? { ...getSettings().overlay, enabled: false } : getSettings().overlay), gameRunning: () => !!tracker?.running(), mainWindow: getMainWindow })
  pushToTalk = new PushToTalkHotkey((down) => broadcast(IPC.voicePushToTalk, down))
  setupScreenShare()
  pushToTalk.configure(getSettings().voice.inputMode === 'ptt', getSettings().voice.pttKey)
  const live = new LiveService({ db, store, fetchFn, getSettings })
  const details = new DetailsService({ db, store, fetchFn, getSettings, steamAppIdFor: (g) => live.steamAppIdFor(g) })

  account = new AccountService({
    store,
    fetchFn,
    authHttp: nodeAuthHttp,
    backend: () => backendConfig({ authUrl: import.meta.env.MAIN_VITE_NEON_AUTH_URL, apiUrl: import.meta.env.MAIN_VITE_VANITY_BACKEND_URL }),
    vault: createSessionVault(join(app.getPath('userData'), 'session.bin')),
    runningGame: () => tracker?.running() ?? null,
    onChange: (s) => {
      broadcast(IPC.accountChanged, s)
      sync?.accountChanged()
      steam?.accountChanged()
    }
  })
  sync = new SyncService({
    db,
    account,
    getSettings,
    applySettings: async (patch) => {
      const after = await updateSettings(patch)
      applyChrome()
      discord?.sync()
      broadcast(IPC.settingsChanged, after)
    },
    deviceName: 'Windows PC',
    onChange: (p) => broadcast(IPC.progressChanged, p)
  })
  sync.start()
  // Games you own on a linked account show in the library even when they aren't installed.
  const owned = new OwnedGames(store, createKv(db), () => broadcast(IPC.gamesChanged, null))
  // One installer per store. A SteamCMD-based one can be added ahead of SteamClientInstaller later.
  const installers = new Installers([new SteamClientInstaller((url) => shell.openExternal(url))])
  const installWatcher = new InstallWatcher({
    // Only the launchers are looked at again (not the custom folders, which need a review step).
    rescan: async () => {
      await runScan({ settings: getSettings(), store, onProgress: () => {}, scannerList: scanners.filter((s) => s.source !== 'custom') })
      owned.reapply()
      metadata?.enqueuePending()
    },
    getGame: (id) => store.get(id),
    onInstalled: (game) => {
      broadcast(IPC.gamesChanged, null)
      broadcast(IPC.gamesInstalled, game)
    }
  })
  // ---- installing Epic and GOG games inside Vanity ----
  const legendary = new Legendary({ binary: legendaryBinary(), configDir: join(app.getPath('userData'), 'legendary'), spawn, killTree })
  const gog = new Gog({ fetchFn, vault: createGogVault(join(app.getPath('userData'), 'gog.bin')) })
  // Epic games Vanity installed are found by the Epic scanner too, so they are never "not found".
  setLegendaryInstalled(async () =>
    (await legendary.installed()).map((g) => ({ source: 'epic' as const, externalId: g.appName, name: g.title, installPath: g.installPath, executablePath: g.executable ? join(g.installPath, g.executable) : null }))
  )
  const downloadLog = join(logsDir(), 'downloads.log')
  const writeLog = (id: string, line: string): void => {
    void (async () => {
      await mkdir(logsDir(), { recursive: true })
      // Kept small: when it passes 2 MB the old one is set aside.
      const size = await stat(downloadLog).then((s) => s.size, () => 0)
      if (size > 2 * 1024 * 1024) await rename(downloadLog, `${downloadLog}.old`).catch(() => {})
      await appendFile(downloadLog, `${new Date().toISOString()} [${id}] ${line}\n`)
    })().catch(() => {})
  }
  downloads = new DownloadManager({
    kv: createKv(db),
    // These install the Windows versions (Legendary for Epic, GOG's Windows installers), so a Mac has none.
    drivers: IS_MAC ? [] : [new EpicDriver(legendary), new GogDriver({ gog, tempDir: join(app.getPath('userData'), 'downloads', 'gog'), exec: runToEnd })],
    getGame: (id) => store.get(id),
    defaultDir: join(homedir(), 'Games'),
    freeSpace: freeSpaceOn,
    onInstalled: async (game) => {
      // Look for it the same way a scan does, so it becomes an installed game in the library.
      await runScan({ settings: getSettings(), store, onProgress: () => {}, scannerList: scanners.filter((s) => s.source !== 'custom') })
      owned.reapply()
      metadata?.enqueuePending()
      broadcast(IPC.gamesChanged, null)
      const now = store.get(game.id)
      if (now?.installed) broadcast(IPC.gamesInstalled, now)
    },
    onChange: (items) => broadcast(IPC.downloadsChanged, items),
    log: writeLog
  })
  const stores = new StoreAccountsService({
    legendary,
    gog,
    epicLoginWindow: () => epicLoginWindow(getMainWindow()),
    gogLoginWindow: () => gogLoginWindow(getMainWindow()),
    onOwned: (source, entries) => owned.set(source, entries),
    onChange: (s) => broadcast(IPC.storesChanged, s)
  })
  stores.start()

  steam = new SteamService({
    db,
    account,
    openExternal: (url) => shell.openExternal(url),
    onOwnedGames: (games) => owned.set('steam', games ? steamOwnedEntries(games) : null),
    onProgress: () => sync?.touch(),
    onChange: (s) => broadcast(IPC.steamChanged, s)
  })
  steam.start()
  void account.load()
  // Sessions of the old account server were kept in settings: they no longer work, so forget them.
  if (getSettings().accountToken) void updateSettings({ accountToken: '', accountUsername: '' })

  const devServer = is.dev && !!process.env['ELECTRON_RENDERER_URL']
  // Installed with the Windows installer: updates come from GitHub Releases (electron-updater).
  // Running from source: the source updater (Vercel server, git or GitHub).
  update = app.isPackaged
    ? new ReleaseUpdater({
        updater: autoUpdater,
        currentVersion: app.getVersion(),
        onUpdate: (s) => broadcast(IPC.updateChanged, s),
        log: (m) => console.warn(m),
        // A Mac build without a Developer ID signature can't update itself: it points to the new .dmg.
        manual: IS_MAC && import.meta.env.MAIN_VITE_MAC_SIGNED !== '1' ? { url: 'https://github.com/NoVanity99/Vanity/releases/latest', open: (url) => shell.openExternal(url) } : undefined
      })
    : new UpdateService({
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
        setTimeout(() => getMainWindow()?.webContents.reloadIgnoringCache(), 2500)
      } else {
        app.relaunch()
        app.quit()
      }
    }
  })
  update.start()

  registerIpc({ pushToTalk, store, collections: tracked(createCollectionsStore(db), ['list'], () => sync?.collectionsChanged()), sync, steam, owned, installers, installWatcher, downloads, stores, legendary, downloadLog, gameWindows, tracker, metadata, media, trending, status, music, live, details, update, discord, db, account, stats: () => playStats(db!), onSettingsChanged: () => {
      applyChrome()
      syncTray()
      overlay?.refresh()
    }
  })
  if (IS_MAC) setMacMenu({ openSettings: () => openPage('/settings'), about: showAbout })
  createWindow()

  // Ctrl+Alt+V from anywhere (even in a game) brings Vanity to the front; pressed again while it's focused, it hides it.
  globalShortcut.register('CommandOrControl+Alt+V', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isFocused() && !win.isMinimized()) return win.minimize()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  if (opened.warning) dialog.showMessageBox({ type: 'warning', title: 'Vanity', message: opened.warning })
  // Fetch artwork for games that don't have it yet (or failed last time), in the background.
  metadata.enqueuePending()
  // Keep the Trending list fresh in the background so the tab opens instantly.
  trending.start()
  status.start()

  app.on('activate', () => {
    // Clicking the Dock icon: the window comes back.
    if (!getMainWindow()) createWindow()
    else showMainWindow()
  })
})

/** Shows the window and goes to one of its pages (from the Mac menu bar). */
function openPage(path: string): void {
  showMainWindow()
  getMainWindow()?.webContents.send(IPC.appNavigate, path)
}

function showAbout(): void {
  app.setAboutPanelOptions({ applicationName: 'Vanity', applicationVersion: app.getVersion(), version: '', copyright: 'Copyright © 2026 NoVanity99', iconPath: icon })
  app.showAboutPanel()
}

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

// Stop a running download cleanly (it is paused, and continues next time).
let downloadsStopped = false
app.on('before-quit', (event) => {
  if (downloadsStopped || !downloads || !downloads.list().some((i) => i.state === 'downloading' || i.state === 'preparing')) return
  event.preventDefault()
  downloadsStopped = true
  void Promise.race([downloads.shutdown(), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit())
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  tray?.destroy()
  tray = null
  pushToTalk?.stop()
  overlay?.close()
  stopScreenAudio()
  // Record playtime up to now for games still running; tracking stops with the app.
  tracker?.stopAll()
  gameWindows?.closeAll()
  metadata?.dispose()
  trending?.dispose()
  status?.dispose()
  update?.dispose()
  discord?.dispose()
  breaks?.dispose()
  db?.close()
  db = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
