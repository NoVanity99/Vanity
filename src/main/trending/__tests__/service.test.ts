import { describe, expect, it, vi } from 'vitest'
import type { Settings, TrendingState } from '@shared/types'
import { openDatabase } from '../../db/database'
import type { FetchFn } from '../../metadata/http'
import { fakeFetch, json } from '../../metadata/__tests__/fakeFetch'
import { REFRESH_MS, TrendingService } from '../service'

const settings: Settings = {
  steamGridDbApiKey: '',
  igdbClientId: 'CID',
  igdbClientSecret: 'SECRET',
  customFolders: [],
  enabledSources: { steam: true, epic: true, gog: true, ea: true, ubisoft: true, custom: true },
  ignoredExecutables: []
}

/** IGDB/Twitch/Steam answering like their documented APIs, with two trending PC games. */
function apis() {
  return fakeFetch([
    (c) => (c.url.includes('id.twitch.tv') ? json({ access_token: 'T', expires_in: 5_000_000 }) : undefined),
    (c) => (c.url.endsWith('/popularity_types') ? json([{ id: 3, name: 'Playing' }]) : undefined),
    (c) => (c.url.endsWith('/popularity_primitives') ? json([{ game_id: 1, value: 9 }, { game_id: 2, value: 5 }]) : undefined),
    (c) =>
      c.url.endsWith('/v4/games')
        ? json([
            { id: 1, name: 'Counter-Strike 2', slug: 'counter-strike-2', external_games: [{ uid: '730', external_game_source: 1 }] },
            { id: 2, name: 'Fortnite', slug: 'fortnite', websites: [{ url: 'https://store.epicgames.com/p/fortnite' }] }
          ])
        : undefined,
    (c) => (c.url.includes('/helix/games/top') ? json({ data: [{ id: '33214', igdb_id: '2' }] }) : undefined),
    (c) => (c.url.includes('/helix/streams') ? json({ data: [{ viewer_count: 80000 }] }) : undefined),
    (c) => (c.url.includes('GetNumberOfCurrentPlayers') ? json({ response: { player_count: 900000, result: 1 } }) : undefined)
  ])
}

function setup(fetch: FetchFn, over: Partial<Settings> = {}, now = () => Date.now()) {
  const db = openDatabase(':memory:').db
  const updates: TrendingState[] = []
  const opened: string[] = []
  const service = new TrendingService({
    db,
    fetchFn: fetch,
    getSettings: () => ({ ...settings, ...over }),
    isProtocolRegistered: (p) => p === 'steam',
    openExternal: async (url) => void opened.push(url),
    onUpdate: (s) => updates.push(s),
    now
  })
  return { db, service, updates, opened }
}

describe('TrendingService', () => {
  it('aggregates, caches and serves the list', async () => {
    const { db, service, updates } = setup(apis().fetch)
    await service.refresh()
    const s = service.state()
    expect(s.error).toBeNull()
    expect(s.games.map((g) => [g.rank, g.title, g.popularityStat.kind])).toEqual([
      [1, 'Counter-Strike 2', 'players'],
      [2, 'Fortnite', 'viewers']
    ])
    expect(updates.at(0)?.refreshing).toBe(true)
    expect(updates.at(-1)?.refreshing).toBe(false)

    // A new service on the same database has the list straight away, without fetching.
    const reopened = new TrendingService({
      db,
      fetchFn: async () => {
        throw new TypeError('offline')
      },
      getSettings: () => settings,
      isProtocolRegistered: () => false,
      openExternal: async () => {},
      onUpdate: () => {}
    })
    expect(reopened.state().games.map((g) => g.title)).toEqual(['Counter-Strike 2', 'Fortnite'])
  })

  it('refreshes stale caches in the background', async () => {
    let t = 1_000_000
    const { fetch, calls } = apis()
    const { service } = setup(fetch, {}, () => t)
    await service.refresh()
    const before = calls.length
    expect(service.get().refreshing).toBe(false) // fresh: no fetch
    t += REFRESH_MS + 1
    expect(service.get().refreshing).toBe(true)
    await service.refresh()
    expect(calls.length).toBeGreaterThan(before)
  })

  it('keeps the cached list and reports the error when a refresh fails', async () => {
    let fail = false
    const ok = apis().fetch
    const fetch: FetchFn = (url, init) => (fail ? Promise.reject(new TypeError('offline')) : ok(url, init))
    const { service } = setup(fetch)
    await service.refresh()
    fail = true
    await service.refresh()
    expect(service.state()).toMatchObject({ error: expect.stringMatching(/Couldn't reach IGDB/), needsKeys: false })
    expect(service.state().games).toHaveLength(2)
  })

  it('asks for keys when they are missing', async () => {
    const { service } = setup(apis().fetch, { igdbClientId: '' })
    await service.refresh()
    expect(service.state()).toMatchObject({ needsKeys: true, error: expect.stringMatching(/MAIN_VITE_IGDB_CLIENT_ID/) })
  })

  it('opens the launcher when installed and the browser otherwise', async () => {
    const { service, opened } = setup(apis().fetch)
    await service.refresh()
    expect(await service.open(1, 'steam')).toBe('launcher')
    expect(await service.open(2, 'epic')).toBe('browser')
    expect(opened).toEqual(['steam://store/730', 'https://store.epicgames.com/p/fortnite'])
    await expect(service.open(2, 'steam')).rejects.toThrow(/no longer available/)
  })

  it('reports installed launchers', () => {
    const { service } = setup(apis().fetch)
    expect(service.installed()).toMatchObject({ steam: true, epic: false, microsoft: false })
  })

  it('runs on a timer', async () => {
    vi.useFakeTimers()
    try {
      const { fetch, calls } = apis()
      const { service } = setup(fetch)
      service.start()
      await vi.advanceTimersByTimeAsync(100)
      const first = calls.length
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 100)
      expect(calls.length).toBeGreaterThan(first)
      service.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
