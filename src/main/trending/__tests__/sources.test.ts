import { describe, expect, it } from 'vitest'
import { Igdb } from '../../metadata/igdb'
import { TwitchAppToken, TwitchHelix } from '../../metadata/twitch'
import { fakeFetch, json } from '../../metadata/__tests__/fakeFetch'
import { fetchIgdbGames, fetchIgdbPopularity, fetchSteamPlayers, fetchTwitchTop, fetchTwitchViewers } from '../sources'

const token = (c: { url: string }) => (c.url.includes('id.twitch.tv') ? json({ access_token: 'T', expires_in: 5_000_000 }) : undefined)

describe('IGDB sources', () => {
  it('weights popularity types found by name', async () => {
    const { fetch, calls } = fakeFetch([
      token,
      (c) => (c.url.endsWith('/popularity_types') ? json([{ id: 1, name: 'Visits' }, { id: 3, name: 'Playing' }, { id: 9, name: 'Something else' }]) : undefined),
      (c) => {
        if (!c.url.endsWith('/popularity_primitives')) return undefined
        return c.body?.includes('popularity_type = 3')
          ? json([{ game_id: 10, value: 50 }, { game_id: 20, value: 10 }])
          : json([{ game_id: 20, value: 900 }, { game_id: 30, value: 5 }])
      }
    ])
    const scores = await fetchIgdbPopularity(new Igdb('C', 'S', fetch))
    expect(scores.get(10)! > scores.get(30)!).toBe(true)
    expect(scores.has(20)).toBe(true)
    expect(calls.filter((c) => c.url.endsWith('/popularity_primitives'))).toHaveLength(2)
  })

  it('falls back to known types when the type list is unavailable', async () => {
    const { fetch, calls } = fakeFetch([
      token,
      (c) => (c.url.endsWith('/popularity_types') ? json({ message: 'nope' }, 500) : undefined),
      (c) => (c.url.endsWith('/popularity_primitives') ? json([{ game_id: 1, value: 1 }]) : undefined)
    ])
    expect((await fetchIgdbPopularity(new Igdb('C', 'S', fetch))).get(1)).toBeGreaterThan(0)
    expect(calls.some((c) => c.body?.includes('popularity_type = 3'))).toBe(true)
  })

  it('fetches PC games with store data and skips editions', async () => {
    const { fetch, calls } = fakeFetch([
      token,
      () =>
        json([
          {
            id: 1,
            name: 'Elden Ring',
            slug: 'elden-ring',
            cover: { image_id: 'co4jni' },
            websites: [{ url: 'https://store.steampowered.com/app/1245620' }],
            external_games: [{ uid: '1245620', external_game_source: 1 }, { uid: '1', external_game_source: 5 }]
          },
          { id: 2, name: 'Elden Ring Deluxe', version_parent: 1 }
        ])
    ])
    const games = await fetchIgdbGames(new Igdb('C', 'S', fetch), [1, 2])
    expect(games).toEqual([
      { id: 1, name: 'Elden Ring', slug: 'elden-ring', coverImageId: 'co4jni', urls: ['https://store.steampowered.com/app/1245620'], steamAppId: '1245620', gogId: '1' }
    ])
    expect(calls.at(-1)!.body).toContain('where id = (1,2) & platforms = (6)')
  })
})

describe('Steam and Twitch sources', () => {
  it('reads current Steam players and skips failures', async () => {
    const { fetch } = fakeFetch([
      (c) => (c.url.includes('appid=730') ? json({ response: { player_count: 1234567, result: 1 } }) : undefined),
      (c) => (c.url.includes('appid=1') ? json({ response: { result: 42 } }) : undefined)
    ])
    expect(await fetchSteamPlayers(fetch, ['730', '1', '2'])).toEqual(new Map([['730', 1234567]]))
  })

  it('maps Twitch top games to IGDB IDs and sums viewers', async () => {
    const { fetch, calls } = fakeFetch([
      token,
      (c) =>
        c.url.includes('/helix/games/top')
          ? json({ data: [{ id: '509658', name: 'Just Chatting', igdb_id: '' }, { id: '32982', name: 'GTA V', igdb_id: '1020' }] })
          : undefined,
      (c) => (c.url.includes('/helix/streams') ? json({ data: [{ viewer_count: 100 }, { viewer_count: 23 }] }) : undefined)
    ])
    const helix = new TwitchHelix(new TwitchAppToken('CID', 'S', fetch), fetch)
    expect(await fetchTwitchTop(helix)).toEqual([{ twitchId: '32982', igdbId: 1020, rank: 2 }])
    expect(await fetchTwitchViewers(helix, ['32982'])).toEqual(new Map([['32982', 123]]))
    const helixCall = calls.find((c) => c.url.includes('/helix/'))!
    expect(helixCall.headers['client-id']).toBe('CID')
    expect(helixCall.headers.authorization).toBe('Bearer T')
  })
})
