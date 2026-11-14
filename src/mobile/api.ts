import type { Result, VanityApi } from '@shared/ipc'
import type { ArtworkKind, DiscordStatus, Game, GamePatch, MatchCandidate, ScanSummary, SessionState, Settings } from '@shared/types'
import { gameKey } from '../main/account/gameKey'
import { AccountService } from '../main/account/service'
import type { Db } from '../main/db/database'
import { DetailsService } from '../main/details/service'
import { createCollectionsStore } from '../main/library/collections'
import { createPlaytimeStore } from '../main/library/playtime'
import { gamePlayStats, playStats } from '../main/library/stats'
import { createSqliteStore } from '../main/library/store'
import { LiveService } from '../main/live/service'
import type { MediaCache } from '../main/metadata/mediaCache'
import { createMetadataRepo } from '../main/metadata/repo'
import { MetadataService } from '../main/metadata/service'
import { StatusService } from '../main/status/service'
import { TrendingService } from '../main/trending/service'
import { MobileMedia } from './media'
import { native, type NativeApp, type NativeTrack } from './native'
import { addApp, appsNotInLibrary, scanAndroid } from './scan'
import { accountServerUrl, getSettings, updateSettings } from './settings'
import { MobileTracker } from './tracker'
import { MobileUpdater } from './update'

/** One list of listeners per event the UI can subscribe to. */
function emitter<T>(): { emit(v: T): void; on(cb: (v: T) => void): () => void } {
  const listeners = new Set<(v: T) => void>()
  return {
    emit: (v) => listeners.forEach((l) => l(v)),
    on: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}

async function wrap<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { data: await fn() }
  } catch (err) {
    console.warn('[vanity]', err)
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

const KINDS = new Set<ArtworkKind>(['cover', 'hero', 'logo', 'icon'])
const validKind = (kind: ArtworkKind): ArtworkKind => {
  if (!KINDS.has(kind)) throw new Error(`Unknown artwork kind: ${kind}`)
  return kind
}
const NOT_ON_ANDROID = 'Not available on Android.'

/**
 * Vanity's backend on Android: the same services as the desktop app's main process,
 * running inside the app's web view, with the phone-specific parts (installed games,
 * launching, playtime, music) going through the native plugin.
 */
export function createMobileApi(db: Db, appVersion: string): VanityApi {
  const fetchFn = (url: string, init?: RequestInit): Promise<Response> => fetch(url, init)
  const openUrl = (url: string): Promise<void> => native.openUrl({ url })

  const store = createSqliteStore(db)
  const collections = createCollectionsStore(db)
  const playtime = createPlaytimeStore(db)

  const sessionsChanged = emitter<{ gameId: number; state: SessionState }>()
  const metadataProgress = emitter<ReturnType<MetadataService['progress']>>()
  const gameUpdated = emitter<number>()
  const trendingUpdated = emitter<ReturnType<TrendingService['state']>>()
  const accountChanged = emitter<ReturnType<AccountService['state']>>()
  const statusUpdated = emitter<ReturnType<StatusService['get']>>()
  const updateChanged = emitter<ReturnType<MobileUpdater['state']>>()
  const scanProgress = emitter<ScanSummary['progress']>()

  // ---- installed apps (cached for a moment: scanning and "Add a game" both ask) ----
  let appsCache: { at: number; apps: NativeApp[] } | null = null
  const installedApps = async (fresh = false): Promise<NativeApp[]> => {
    if (!fresh && appsCache && Date.now() - appsCache.at < 15_000) return appsCache.apps
    const { apps } = await native.listApps()
    appsCache = { at: Date.now(), apps }
    return apps
  }

  const metadata = new MetadataService({
    store,
    repo: createMetadataRepo(db),
    media: new MobileMedia() as unknown as MediaCache,
    fetchFn,
    getSettings,
    onProgress: (p) => metadataProgress.emit(p),
    onGameUpdated: (id) => gameUpdated.emit(id)
  })

  const trending = new TrendingService({
    db,
    fetchFn,
    getSettings,
    // No PC launchers on a phone: store pages open in the browser (or the store's own app).
    isProtocolRegistered: () => false,
    openExternal: openUrl,
    onUpdate: (s) => trendingUpdated.emit(s)
  })

  const status = new StatusService({ fetchFn, onUpdate: (s) => statusUpdated.emit(s) })
  const live = new LiveService({ db, store, fetchFn, getSettings })
  const details = new DetailsService({ db, store, fetchFn, getSettings, steamAppIdFor: (g) => live.steamAppIdFor(g) })

  const tracker = new MobileTracker({
    db,
    playtime,
    games: () => store.list().filter((g) => g.source === 'android'),
    launch: (packageName) => native.launch({ packageName }),
    usageAccess: async () => (await native.usageAccess()).granted,
    usage: async (since, packages) => (await native.usage({ since, packages })).sessions,
    onChange: (gameId, state) => {
      sessionsChanged.emit({ gameId, state })
      account.onSessionChange(state)
    }
  })

  const account: AccountService = new AccountService({
    store,
    fetchFn,
    getSettings,
    saveSettings: updateSettings,
    serverUrl: accountServerUrl,
    runningGame: () => tracker.running(),
    onChange: (s) => accountChanged.emit(s)
  })

  const updater = new MobileUpdater({
    currentVersion: appVersion,
    fetchText: async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    },
    openUrl,
    onUpdate: (s) => updateChanged.emit(s)
  })

  // ---- music: the songs on the phone ----
  let tracks: NativeTrack[] = []
  let musicVersion = 0
  let musicAsked = false
  const loadMusic = async (): Promise<void> => {
    musicAsked = true
    localStorage.setItem('vanity-music-on', '1')
    try {
      const res = await native.listMusic()
      tracks = res.granted ? res.tracks : []
    } catch (err) {
      console.warn('[music]', err)
      tracks = []
    }
    musicVersion++
  }
  const musicState = (): { folder: string | null; count: number; version: number } => ({ folder: musicAsked ? 'Music on this phone' : null, count: tracks.length, version: musicVersion })
  const fileSrc = (uri: string): string => window.Capacitor?.convertFileSrc?.(uri) ?? uri

  // ---- scanning ----
  let scanning: Promise<ScanSummary> | null = null
  const scan = (): Promise<ScanSummary> => {
    scanning ??= (async () => {
      const summary = scanAndroid(db, store, await installedApps(true))
      metadata.enqueuePending()
      scanProgress.emit(summary.progress)
      return summary
    })().finally(() => (scanning = null))
    return scanning
  }

  // If music was turned on before, the permission is already granted: load it without asking.
  if (localStorage.getItem('vanity-music-on')) void loadMusic()

  // ---- start background work ----
  account.start()
  trending.start()
  status.start()
  updater.start()
  metadata.enqueuePending()
  void tracker.sync()
  // Coming back to Vanity: record what was played, and tell friends we're here.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tracker.sync()
  })
  // Links that would open a new window (news, trailers, store pages) open outside the app.
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null
      if (!a || !/^https?:\/\//i.test(a.href)) return
      e.preventDefault()
      void openUrl(a.href)
    },
    true
  )

  const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '')
  const discordOff: DiscordStatus = { state: 'off', user: null, error: null }

  return {
    platform: 'android',
    games: {
      list: async () => store.list(),
      get: async (id) => store.get(id),
      update: async (id, patch: GamePatch) => store.update(id, patch),
      remove: async (id) => store.remove(id),
      removed: async () => store.removed().map((g) => g.name),
      restoreRemoved: async () => store.restoreRemoved(),
      openFolder: async () => NOT_ON_ANDROID,
      launch: async (id) => {
        const game = store.get(id)
        if (!game) return 'This game is no longer in your library.'
        try {
          await tracker.launch(game)
          return null
        } catch (err) {
          console.warn('[launch]', err)
          return `Couldn't open ${game.name}. It may have been uninstalled.`
        }
      },
      pickExecutable: async () => null,
      confirmCandidates: async () => [],
      // On Android, "Add a game" shows a list of installed apps instead (installedApps / addApp).
      addManually: async () => null,
      installedApps: async () => appsNotInLibrary(store, await installedApps()),
      addApp: async (packageName) => {
        const game = addApp(db, store, await installedApps(), text(packageName, 300))
        if (game) metadata.enqueue([game.id])
        return game
      },
      playStats: async (id) => gamePlayStats(db, Number(id)),
      details: (id, refresh) => details.forGame(Number(id), refresh === true).catch(() => null),
      diskSize: async () => null
    },
    collections: {
      list: async () => collections.list(),
      create: (name) => wrap(() => collections.create(name)),
      rename: (id, name) => wrap(() => collections.rename(Number(id), name)),
      remove: async (id) => collections.remove(Number(id)),
      setMember: (collectionId, gameId, member) =>
        wrap(() => {
          collections.setMember(Number(collectionId), Number(gameId), member === true)
          return store.get(Number(gameId))
        })
    },
    playtime: {
      usageAccess: async () => (await native.usageAccess().catch(() => ({ granted: false }))).granted,
      openUsageSettings: () => native.openUsageSettings()
    },
    sessions: {
      states: async () => tracker.states(),
      onChange: (cb) => sessionsChanged.on(cb)
    },
    metadata: {
      progress: async () => metadata.progress(),
      onProgress: (cb) => metadataProgress.on(cb),
      onGameUpdated: (cb) => gameUpdated.on(cb),
      refresh: (id) =>
        wrap(async () => {
          await metadata.process(id, true)
          return store.get(id)
        }),
      refreshAll: async () => metadata.refreshAll(),
      search: (query) => wrap(() => metadata.search(String(query))),
      applyMatch: (id, candidate: MatchCandidate) => wrap(() => metadata.applyMatch(id, candidate)),
      artworkOptions: (id, kind) => wrap(() => metadata.artworkOptions(id, validKind(kind))),
      setArtwork: (id, kind, url) =>
        wrap(async () => {
          if (!/^https:\/\//i.test(url)) throw new Error('Invalid image address.')
          return metadata.setArtworkFromUrl(id, validKind(kind), url)
        }),
      setArtworkFromFile: () => wrap<Game | null>(() => Promise.reject(new Error('Choosing your own image file is not available on Android yet.'))),
      resetArtwork: (id, kind) => wrap(() => metadata.resetArtwork(id, validKind(kind))),
      checkKeys: () => metadata.checkKeys()
    },
    trending: {
      get: async () => trending.get(),
      refresh: async () => {
        await trending.refresh()
        return trending.state()
      },
      onUpdate: (cb) => trendingUpdated.on(cb),
      installed: async () => trending.installed(),
      open: (gameId, launcher) => wrap(() => trending.open(Number(gameId), launcher)),
      follow: async (gameId, on) => trending.follow(Number(gameId), on === true)
    },
    account: {
      state: async () => account.state(),
      onChange: (cb) => accountChanged.on(cb),
      setServer: (url) => wrap(() => account.setServer(text(url, 500))),
      register: (u, p) => wrap(() => account.register(text(u), text(p))),
      login: (u, p) => wrap(() => account.login(text(u), text(p))),
      logout: () => account.logout(),
      deleteAccount: () => wrap(() => account.deleteAccount())
    },
    friends: {
      list: () => wrap(() => account.guard((c) => c.friends())),
      add: (u) => wrap(async () => (await account.guard((c) => c.addFriend(text(u)))).status),
      accept: (id) => wrap(async () => (await account.guard((c) => c.accept(text(id))), true as const)),
      decline: (id) => wrap(async () => (await account.guard((c) => c.decline(text(id))), true as const)),
      remove: (id) => wrap(async () => (await account.guard((c) => c.removeFriend(text(id))), true as const)),
      stats: (id) => wrap(() => account.guard((c) => c.friendStats(text(id)))),
      forGame: (gameId) =>
        wrap(async () => {
          const game = store.get(Number(gameId))
          if (!game) return []
          return account.guard((c) => c.gameFriends(gameKey(game.name)))
        })
    },
    stats: {
      get: async () => playStats(db)
    },
    live: {
      game: (id) => live.forGame(Number(id)).catch(() => null),
      library: () => live.libraryPlayers().catch(() => ({})),
      openWorkshop: () => wrap<true>(() => Promise.reject(new Error(NOT_ON_ANDROID)))
    },
    music: {
      state: async () => musicState(),
      // There are no folders to pick on a phone: this asks for permission and finds every song.
      pickFolder: async () => {
        await loadMusic()
        return musicState()
      },
      track: async (index) => {
        const t = tracks[index]
        return t ? { title: t.title, artist: t.artist, album: t.album, hasArt: t.art !== null } : null
      },
      url: (index) => (tracks[index] ? fileSrc(tracks[index].uri) : ''),
      artUrl: (index) => (tracks[index]?.art ? fileSrc(tracks[index].art!) : '')
    },
    status: {
      get: async () => status.get(),
      refresh: async () => {
        await status.check()
        return status.get()
      },
      onUpdate: (cb) => statusUpdated.on(cb)
    },
    window: {
      setFullScreen: async () => {}
    },
    // Discord Rich Presence talks to the Discord desktop app, which doesn't exist on a phone.
    discord: {
      status: async () => discordOff,
      onStatus: () => () => {},
      setListening: () => {}
    },
    update: {
      state: async () => updater.state(),
      check: () => updater.check(),
      apply: () => wrap(async () => (await updater.apply(), true as const)),
      onChange: (cb) => updateChanged.on(cb)
    },
    scan: {
      start: scan,
      onProgress: (cb) => scanProgress.on(cb)
    },
    settings: {
      get: async () => getSettings(),
      update: async (patch: Partial<Settings>) => {
        const before = getSettings()
        const after = await updateSettings(patch)
        if (before.steamGridDbApiKey !== after.steamGridDbApiKey || before.igdbClientId !== after.igdbClientId || before.igdbClientSecret !== after.igdbClientSecret) {
          metadata.onKeysChanged()
          void trending.refresh()
        }
        return after
      },
      pickFolder: async () => null
    }
  }
}

declare global {
  interface Window {
    Capacitor?: { convertFileSrc?: (path: string) => string; getPlatform?: () => string }
  }
}
