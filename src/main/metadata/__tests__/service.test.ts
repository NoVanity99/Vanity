import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { DetectedGame, MetadataProgress, Settings } from '@shared/types'
import { openDatabase } from '../../db/database'
import { createSqliteStore } from '../../library/store'
import type { FetchFn } from '../http'
import { MediaCache } from '../mediaCache'
import { createMetadataRepo } from '../repo'
import { MetadataService } from '../service'
import { fakeFetch, image, json, type Call } from './fakeFetch'

const baseSettings: Settings = {
  steamGridDbApiKey: 'SGDB',
  igdbClientId: 'CID',
  igdbClientSecret: 'SECRET',
  customFolders: [],
  enabledSources: { steam: true, epic: true, gog: true, ea: true, ubisoft: true, custom: true },
  ignoredExecutables: [],
  theme: 'midnight',
  font: 'system',
  ambientBackground: true,
  minimizeWhilePlaying: false,
  musicFolder: null,
  musicVolume: 0.5
}

const portal: DetectedGame = { source: 'steam', externalId: '620', name: 'Portal 2', installPath: '/p', executablePath: null }
const celeste: DetectedGame = { source: 'custom', externalId: '/g/celeste.exe', name: 'Celeste', installPath: '/g', executablePath: '/g/celeste.exe' }

/** Fake versions of the three APIs, shaped like their documented responses. */
function apis(over: { offline?: boolean; sgdbStatus?: number } = {}) {
  return fakeFetch([
    () => {
      if (over.offline) throw new TypeError('fetch failed')
      return undefined
    },
    (c: Call) => (c.url.includes('id.twitch.tv') ? json({ access_token: 'T', expires_in: 5_000_000 }) : undefined),
    (c: Call) => (over.sgdbStatus && c.url.includes('steamgriddb.com/api') ? json({ success: false }, over.sgdbStatus) : undefined),
    (c: Call) => (c.url.endsWith('/games/steam/620') ? json({ success: true, data: { id: 100, name: 'Portal 2' } }) : undefined),
    (c: Call) =>
      c.url.includes('/search/autocomplete/Celeste')
        ? json({ success: true, data: [{ id: 200, name: 'Celeste Classic' }, { id: 201, name: 'Celeste' }] })
        : undefined,
    (c: Call) => {
      const m = /\/(grids|heroes|logos|icons)\/game\/(\d+)/.exec(c.url)
      if (!m) return undefined
      return json({ success: true, data: [{ id: 1, url: `https://cdn2.steamgriddb.com/${m[1]}/${m[2]}.png`, thumb: '', width: 1, height: 1 }] })
    },
    (c: Call) => (c.url.startsWith('https://cdn2.steamgriddb.com/') ? image() : undefined),
    (c: Call) => (c.url.endsWith('/external_games') ? json([{ game: 72 }]) : undefined),
    (c: Call) => {
      if (!c.url.endsWith('/v4/games')) return undefined
      if (c.body?.startsWith('search')) return json([{ id: 300, name: 'Celeste', first_release_date: 1516665600 }])
      const id = Number(/where id = (\d+)/.exec(c.body ?? '')?.[1])
      return json([
        {
          id,
          name: id === 72 ? 'Portal 2' : 'Celeste',
          summary: id === 72 ? 'Portal sequel.' : 'Climb a mountain.',
          first_release_date: 1303171200,
          genres: [{ name: 'Puzzle' }],
          involved_companies: [{ developer: true, company: { name: id === 72 ? 'Valve' : 'Maddy Makes Games' } }]
        }
      ])
    }
  ])
}

function setup(fetch: FetchFn, settings: Partial<Settings> = {}) {
  const db = openDatabase(':memory:').db
  const store = createSqliteStore(db)
  const progress: MetadataProgress[] = []
  const service = new MetadataService({
    store,
    repo: createMetadataRepo(db),
    media: new MediaCache(mkdtempSync(join(tmpdir(), 'vanity-svc-')), fetch),
    fetchFn: fetch,
    getSettings: () => ({ ...baseSettings, ...settings }),
    onProgress: (p) => progress.push(p),
    onGameUpdated: () => {}
  })
  return { db, store, service, progress }
}

describe('MetadataService', () => {
  it('matches a Steam game by app ID and fills in everything', async () => {
    const { fetch, calls } = apis()
    const { store, service } = setup(fetch)
    const [g] = store.upsert([portal]).games
    await service.process(g.id)
    const after = store.get(g.id)!
    expect(after.metadata).toMatchObject({ status: 'matched', steamGridDbId: 100, igdbId: 72, error: null })
    expect(after).toMatchObject({ description: 'Portal sequel.', genres: ['Puzzle'], developer: 'Valve', releaseDate: '2011-04-19' })
    expect(after.coverPath).toMatch(/^games\/\d+\/cover-/)
    expect(after.heroPath && after.logoPath && after.iconPath).toBeTruthy()
    // Matched by app ID: no name searches needed.
    expect(calls.some((c) => c.url.includes('autocomplete') || c.body?.startsWith('search'))).toBe(false)
  })

  it('matches other games by fuzzy name', async () => {
    const { fetch } = apis()
    const { store, service } = setup(fetch)
    const [g] = store.upsert([celeste]).games
    await service.process(g.id)
    expect(store.get(g.id)!.metadata).toMatchObject({ status: 'matched', steamGridDbId: 201, igdbId: 300 })
    expect(store.get(g.id)!.developer).toBe('Maddy Makes Games')
  })

  it('uses Steam alone when there are no keys', async () => {
    const { fetch } = fakeFetch([
      (c) =>
        c.url.includes('store.steampowered.com')
          ? json({ '620': { success: true, data: { name: 'Portal 2', short_description: 'From Steam.', genres: [], developers: ['Valve'] } } })
          : undefined,
      (c) => (c.url.includes('steamstatic.com') && !c.url.endsWith('logo.png') ? image('image/jpeg') : undefined)
    ])
    const { store, service } = setup(fetch, { steamGridDbApiKey: '', igdbClientId: '', igdbClientSecret: '' })
    const [g, other] = store.upsert([portal, celeste]).games
    await service.process(g.id)
    await service.process(other.id)
    expect(store.get(g.id)).toMatchObject({ description: 'From Steam.', developer: 'Valve' })
    expect(store.get(g.id)!.coverPath).toMatch(/\.jpg$/)
    expect(store.get(g.id)!.logoPath).toBeNull() // 404 is fine
    expect(store.get(g.id)!.metadata.status).toBe('matched')
    expect(store.get(other.id)!.metadata.status).toBe('no-keys')
  })

  it('records a rejected key as an error without throwing', async () => {
    const { fetch } = apis({ sgdbStatus: 401 })
    const { store, service } = setup(fetch, { igdbClientId: '', igdbClientSecret: '' })
    const [g] = store.upsert([celeste]).games
    await expect(service.process(g.id)).resolves.toBeUndefined()
    expect(store.get(g.id)!.metadata).toMatchObject({ status: 'error', error: expect.stringMatching(/key was rejected/) })
  })

  it('marks games for retry and pauses the queue when offline', async () => {
    const { fetch } = apis({ offline: true })
    const { store, service, progress } = setup(fetch)
    const games = store.upsert([portal, celeste, { ...celeste, externalId: 'x', name: 'Hades' }]).games
    service.enqueue(games.map((g) => g.id))
    for (let i = 0; i < 100 && progress.at(-1)?.running !== false; i++) await new Promise((r) => setTimeout(r, 20))
    expect(progress.at(-1)).toMatchObject({ running: false })
    expect(store.get(games[0].id)!.metadata.status).toBe('error')
    service.dispose()
  })

  it('retries every game it dropped while offline', async () => {
    vi.useFakeTimers()
    try {
      let offline = true
      const online = apis()
      const fetch: FetchFn = (url, init) => (offline ? Promise.reject(new TypeError('fetch failed')) : online.fetch(url, init))
      const { db, store, service } = setup(fetch)
      const games = store.upsert([portal, celeste, { ...celeste, externalId: 'x', name: 'Hades' }]).games
      // As after adding keys: these were "no-keys", which a plain pending-retry would skip.
      db.prepare("UPDATE games SET metadata_status = 'no-keys'").run()
      service.onKeysChanged()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(games.map((g) => store.get(g.id)!.metadata.status)).toContain('no-keys') // dropped while offline
      offline = false
      await vi.advanceTimersByTimeAsync(11 * 60_000)
      expect(games.map((g) => store.get(g.id)!.metadata.status)).not.toContain('no-keys')
      service.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves user edits and picks alone on refresh', async () => {
    const { fetch } = apis()
    const { store, service } = setup(fetch)
    const [g] = store.upsert([portal]).games
    store.update(g.id, { description: 'My own notes', genres: ['Favourite'] })
    await service.process(g.id, true)
    expect(store.get(g.id)).toMatchObject({ description: 'My own notes', genres: ['Favourite'] })
    expect(store.get(g.id)!.metadata.detailsLocked).toBe(true)
  })

  it('applies a manual match and refetches for it', async () => {
    const { fetch } = apis()
    const { store, service } = setup(fetch)
    const [g] = store.upsert([{ ...celeste, name: 'cel_final_v2' }]).games
    await service.process(g.id)
    expect(store.get(g.id)!.metadata.status).toBe('unmatched')
    const results = await service.search('Celeste')
    const updated = await service.applyMatch(g.id, results[0])
    expect(updated!.metadata).toMatchObject({ status: 'matched', igdbId: 300, steamGridDbId: 201, matchLocked: true })
    expect(updated!.description).toBe('Climb a mountain.')
    // A locked match survives a forced refresh.
    await service.process(g.id, true)
    expect(store.get(g.id)!.metadata.igdbId).toBe(300)
  })

  it('locks hand-picked artwork and can reset it', async () => {
    const { fetch } = apis()
    const { store, service } = setup(fetch)
    const [g] = store.upsert([portal]).games
    await service.process(g.id)
    const picked = await service.setArtworkFromUrl(g.id, 'cover', 'https://cdn2.steamgriddb.com/custom/cover.png')
    expect(picked!.metadata.lockedArtwork).toEqual(['cover'])
    await service.process(g.id, true)
    expect(store.get(g.id)!.coverPath).toBe(picked!.coverPath)
    const reset = await service.resetArtwork(g.id, 'cover')
    expect(reset!.metadata.lockedArtwork).toEqual([])
    expect(reset!.coverPath).not.toBe(picked!.coverPath)
  })

  it('reports key status', async () => {
    const { fetch } = apis()
    expect(await setup(fetch).service.checkKeys()).toEqual({ steamGridDb: 'ok', igdb: 'ok' })
    expect(await setup(fetch, { steamGridDbApiKey: '' }).service.checkKeys()).toMatchObject({ steamGridDb: 'missing' })
    expect(await setup(apis({ sgdbStatus: 401 }).fetch).service.checkKeys()).toMatchObject({ steamGridDb: 'invalid' })
  })
})
