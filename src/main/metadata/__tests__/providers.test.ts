import { describe, expect, it } from 'vitest'
import { HttpError, NetworkError, request } from '../http'
import { Igdb, toDetails } from '../igdb'
import { SteamGridDb } from '../steamgriddb'
import { decodeEntities, parseSteamDate, steamArtworkUrl, SteamStore } from '../steamStore'
import { fakeFetch, json } from './fakeFetch'

describe('http', () => {
  it('maps connection failures and HTTP errors', async () => {
    const offline = async (): Promise<Response> => {
      throw new TypeError('fetch failed')
    }
    await expect(request(offline, 'https://x')).rejects.toBeInstanceOf(NetworkError)
    const { fetch } = fakeFetch([() => new Response('nope', { status: 500 })])
    await expect(request(fetch, 'https://x')).rejects.toMatchObject({ status: 500 })
  })

  it('retries once after a 429', async () => {
    let n = 0
    const { fetch } = fakeFetch([() => (n++ === 0 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : json({ ok: 1 }))])
    expect(await (await request(fetch, 'https://x')).json()).toEqual({ ok: 1 })
  })
})

describe('SteamGridDB', () => {
  it('sends the key, looks up Steam games and filters artwork', async () => {
    const { fetch, calls } = fakeFetch([
      (c) => (c.url.endsWith('/games/steam/620') ? json({ success: true, data: { id: 5250, name: 'Portal 2' } }) : undefined),
      (c) =>
        c.url.includes('/grids/game/5250')
          ? json({
              success: true,
              data: [
                { id: 1, url: 'https://cdn2.steamgriddb.com/grid/a.png', thumb: 'https://cdn2.steamgriddb.com/thumb/a.jpg', width: 600, height: 900 },
                { id: 2, url: 'https://cdn2.steamgriddb.com/grid/b.png', thumb: '', width: 600, height: 900, nsfw: true }
              ]
            })
          : undefined
    ])
    const sgdb = new SteamGridDb('KEY', fetch)
    expect(await sgdb.gameBySteamAppId('620')).toMatchObject({ id: 5250 })
    const art = await sgdb.artwork('cover', 5250)
    expect(art.map((a) => a.id)).toEqual([1])
    expect(calls[0].headers.authorization).toBe('Bearer KEY')
    expect(calls[1].url).toContain('dimensions=600x900')
    expect(calls[1].url).toContain('nsfw=false')
  })

  it('treats 404 as "not found" and 401 as an error', async () => {
    expect(await new SteamGridDb('K', fakeFetch([]).fetch).gameBySteamAppId('1')).toBeNull()
    const denied = fakeFetch([() => json({ success: false, errors: ['Unauthorized'] }, 401)])
    await expect(new SteamGridDb('bad', denied.fetch).checkKey()).rejects.toBeInstanceOf(HttpError)
  })

  it('URL-encodes search terms', async () => {
    const { fetch, calls } = fakeFetch([() => json({ success: true, data: [{ id: 9, name: 'Ratchet & Clank', release_date: 1618531200 }] })])
    const results = await new SteamGridDb('K', fetch).search('Ratchet & Clank: Rift Apart')
    expect(calls[0].url).toContain('/search/autocomplete/Ratchet%20%26%20Clank%3A%20Rift%20Apart')
    expect(results[0]).toMatchObject({ provider: 'steamgriddb', id: 9, year: 2021 })
  })
})

describe('IGDB', () => {
  const tokenHandler = (c: { url: string }) =>
    c.url.startsWith('https://id.twitch.tv/oauth2/token') ? json({ access_token: 'TOKEN', expires_in: 5000000, token_type: 'bearer' }) : undefined

  it('gets a token once and sends Client-ID + Bearer', async () => {
    const { fetch, calls } = fakeFetch([tokenHandler, (c) => (c.url.endsWith('/external_games') ? json([{ game: 72 }]) : undefined)])
    const igdb = new Igdb('CID', 'SECRET', fetch)
    expect(await igdb.gameIdBySteamAppId('620')).toBe(72)
    expect(await igdb.gameIdBySteamAppId('620')).toBe(72)
    expect(calls.filter((c) => c.url.includes('twitch')).length).toBe(1)
    const api = calls.find((c) => c.url.endsWith('/external_games'))!
    expect(api.headers['client-id']).toBe('CID')
    expect(api.headers.authorization).toBe('Bearer TOKEN')
    expect(api.body).toBe('fields game; where uid = "620" & external_game_source = 1; limit 1;')
  })

  it('falls back to the old "category" field if the new one is rejected', async () => {
    const { fetch, calls } = fakeFetch([
      tokenHandler,
      (c) => (c.body?.includes('external_game_source') ? json([{ title: 'Invalid field' }], 400) : undefined),
      (c) => (c.url.endsWith('/external_games') ? json([{ game: 72 }]) : undefined)
    ])
    expect(await new Igdb('C', 'S', fetch).gameIdBySteamAppId('620')).toBe(72)
    expect(calls.at(-1)!.body).toContain('category = 1')
  })

  it('escapes quotes in searches and skips editions', async () => {
    const { fetch, calls } = fakeFetch([
      tokenHandler,
      () =>
        json([
          { id: 1, name: 'Portal 2', first_release_date: 1303171200, cover: { image_id: 'co1rs4' }, external_games: [{ uid: '620', external_game_source: 1 }] },
          { id: 2, name: 'Portal 2: Collector', version_parent: 1 }
        ])
    ])
    const results = await new Igdb('C', 'S', fetch).search('Say "hi"')
    expect(calls.at(-1)!.body).toContain('search "Say \\"hi\\"";')
    expect(results).toEqual([
      { provider: 'igdb', id: 1, name: 'Portal 2', year: 2011, thumbUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_small/co1rs4.jpg', steamAppId: '620' }
    ])
  })

  it('maps details', () => {
    expect(
      toDetails({
        id: 72,
        name: 'Portal 2',
        summary: ' Sequel. ',
        first_release_date: 1303171200,
        genres: [{ name: 'Puzzle' }, { name: 'Shooter' }],
        involved_companies: [{ developer: false, company: { name: 'EA' } }, { developer: true, company: { name: 'Valve' } }]
      })
    ).toEqual({ id: 72, name: 'Portal 2', summary: 'Sequel.', genres: ['Puzzle', 'Shooter'], releaseDate: '2011-04-19', developer: 'Valve', steamAppId: null })
  })

  it('gets a new token after a 401 and retries', async () => {
    let tokens = 0
    let first = true
    const { fetch } = fakeFetch([
      (c) => (c.url.includes('twitch') ? json({ access_token: `T${++tokens}`, expires_in: 5000000 }) : undefined),
      () => {
        if (first) {
          first = false
          return json({ message: 'expired' }, 401)
        }
        return json([{ id: 1, name: 'X' }])
      }
    ])
    expect(await new Igdb('C', 'S', fetch).details(1)).toMatchObject({ id: 1 })
    expect(tokens).toBe(2)
  })
})

describe('Steam store', () => {
  it('parses appdetails', async () => {
    const { fetch } = fakeFetch([
      () =>
        json({
          '620': {
            success: true,
            data: {
              name: 'Portal 2',
              short_description: 'The &quot;Perpetual Testing Initiative&quot; &amp; more',
              genres: [{ id: '1', description: 'Action' }, { id: '25', description: 'Adventure' }],
              developers: ['Valve'],
              release_date: { coming_soon: false, date: '18 Apr, 2011' }
            }
          }
        })
    ])
    expect(await new SteamStore(fetch).details('620')).toEqual({
      name: 'Portal 2',
      description: 'The "Perpetual Testing Initiative" & more',
      genres: ['Action', 'Adventure'],
      releaseDate: '2011-04-18',
      developer: 'Valve'
    })
  })

  it('parses Steam date formats and builds CDN URLs', () => {
    expect(parseSteamDate('Apr 18, 2011')).toBe('2011-04-18')
    expect(parseSteamDate('Q4 2025')).toBe('2025-01-01')
    expect(parseSteamDate('Coming soon')).toBeNull()
    expect(decodeEntities('&#39;hi&#x27;')).toBe("'hi'")
    expect(steamArtworkUrl('cover', '620')).toBe('https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_600x900_2x.jpg')
    expect(steamArtworkUrl('icon', '620')).toBeNull()
  })
})
