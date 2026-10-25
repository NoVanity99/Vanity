import { describe, expect, it } from 'vitest'
import type { Settings } from '@shared/types'
import { openDatabase } from '../../db/database'
import { createSqliteStore } from '../../library/store'
import { createMetadataRepo } from '../../metadata/repo'
import { fakeFetch, json } from '../../metadata/__tests__/fakeFetch'
import { LiveService } from '../service'

const settings = (keys: boolean): Settings =>
  ({
    steamGridDbApiKey: '',
    igdbClientId: keys ? 'CID' : '',
    igdbClientSecret: keys ? 'S' : '',
    customFolders: [],
    enabledSources: { steam: true, epic: true, gog: true, ea: true, ubisoft: true, custom: true },
    ignoredExecutables: [],
    theme: 'midnight',
    font: 'system',
    ambientBackground: true,
    minimizeWhilePlaying: false,
    musicFolder: null,
    musicVolume: 0.5,
  accountServerUrl: '',
  accountToken: '',
  accountUsername: '',
  controllerEnabled: true,
  githubToken: '',
  discordPresence: false,
  discordClientId: '',
  updateKey: '',
  breakReminderMinutes: 0
  }) as Settings

function apis() {
  return fakeFetch([
    (c) => (c.url.includes('id.twitch.tv') ? json({ access_token: 'T', expires_in: 5_000_000 }) : undefined),
    (c) => (c.url.includes('GetNumberOfCurrentPlayers') ? json({ response: { player_count: Number(/appid=(\d+)/.exec(c.url)![1]) * 10, result: 1 } }) : undefined),
    (c) =>
      c.url.includes('store.steampowered.com/api/appdetails')
        ? json({ [/appids=(\d+)/.exec(c.url)![1]]: { success: true, data: { name: 'X', categories: c.url.includes('4000') ? [{ id: 30 }] : [{ id: 2 }] } } })
        : undefined,
    (c) => (c.url.endsWith('/v4/external_games') ? json([{ uid: '292030' }]) : undefined),
    (c) => (c.url.includes('/helix/games?') ? json({ data: [{ id: 'tw1' }] }) : undefined),
    (c) => (c.url.includes('/helix/streams') ? json({ data: [{ viewer_count: 300 }, { viewer_count: 200 }] }) : undefined)
  ])
}

function setup(keys = true) {
  const { fetch, calls } = apis()
  const db = openDatabase(':memory:').db
  const store = createSqliteStore(db)
  const live = new LiveService({ db, store, fetchFn: fetch, getSettings: () => settings(keys) })
  return { db, store, live, calls }
}

describe('LiveService', () => {
  it('reports Steam players, Twitch viewers and the Workshop for a Steam game', async () => {
    const { store, live, db } = setup()
    const [g] = store.upsert([{ source: 'steam', externalId: '4000', name: "Garry's Mod", installPath: '/g', executablePath: null }]).games
    createMetadataRepo(db).setMatch(g.id, { steamGridDbId: null, igdbId: 99 })
    expect(await live.forGame(g.id)).toMatchObject({ players: 40000, viewers: 500, steamAppId: '4000', workshop: true })
  })

  it('finds the Steam app ID of a non-Steam copy through IGDB, without offering the Workshop', async () => {
    const { store, live, db, calls } = setup()
    const [g] = store.upsert([{ source: 'gog', externalId: '1', name: 'The Witcher 3', installPath: '/w', executablePath: '/w/w.exe' }]).games
    createMetadataRepo(db).setMatch(g.id, { steamGridDbId: null, igdbId: 1942 })
    expect(await live.forGame(g.id)).toMatchObject({ players: 2920300, steamAppId: '292030', workshop: false })
    // Cached: no new requests within 10 minutes.
    const before = calls.length
    await live.forGame(g.id)
    expect(calls.length).toBe(before)
  })

  it('works without Twitch keys (Steam only) and for games with no Steam ID', async () => {
    const { store, live } = setup(false)
    const [steam, custom] = store.upsert([
      { source: 'steam', externalId: '730', name: 'CS2', installPath: '/c', executablePath: null },
      { source: 'custom', externalId: '/x.exe', name: 'Indie', installPath: '/i', executablePath: '/x.exe' }
    ]).games
    expect(await live.forGame(steam.id)).toMatchObject({ players: 7300, viewers: null, workshop: false })
    expect(await live.forGame(custom.id)).toMatchObject({ players: null, viewers: null, steamAppId: null })
  })

  it('collects Steam players for the whole library', async () => {
    const { store, live } = setup(false)
    const games = store.upsert([
      { source: 'steam', externalId: '10', name: 'A', installPath: null, executablePath: null },
      { source: 'steam', externalId: '20', name: 'B', installPath: null, executablePath: null },
      { source: 'epic', externalId: 'x', name: 'C', installPath: null, executablePath: null }
    ]).games
    expect(await live.libraryPlayers()).toEqual({ [games[0].id]: 100, [games[1].id]: 200 })
  })
})
