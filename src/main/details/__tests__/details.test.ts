import { describe, expect, it } from 'vitest'
import type { Settings } from '@shared/types'
import { openDatabase } from '../../db/database'
import { createSqliteStore } from '../../library/store'
import { fakeFetch, json } from '../../metadata/__tests__/fakeFetch'
import { DetailsService } from '../service'
import { htmlToText, newsExcerpt, parseIgdbExtra, parseLanguages, parseSteamExtra } from '../sources'

const settings = { igdbClientId: 'CID', igdbClientSecret: 'SECRET' } as Settings

describe('detail parsers', () => {
  it('reads IGDB credits, ratings, media and similar games', () => {
    const x = parseIgdbExtra({
      aggregated_rating: 88.6,
      aggregated_rating_count: 12,
      rating: 79.2,
      rating_count: 0,
      involved_companies: [
        { developer: true, company: { name: 'Studio' } },
        { publisher: true, company: { name: 'Pub' } },
        { developer: true, publisher: true, company: { name: 'Both' } }
      ],
      franchises: [],
      collections: [{ name: 'Saga' }],
      game_modes: [{ name: 'Single player' }, { name: 'Single player' }],
      screenshots: [{ image_id: 'sc1' }, {}],
      videos: [{ video_id: 'dQw4w9WgXcQ', name: 'Launch trailer' }, { video_id: 'bad id!' }],
      similar_games: [{ id: 5, name: 'Other', cover: { image_id: 'co5' } }, { id: 6 }]
    })
    expect(x.critics).toEqual({ score: 89, count: 12 })
    expect(x.players).toBeNull() // no votes
    expect(x.developers).toEqual(['Studio', 'Both'])
    expect(x.publishers).toEqual(['Pub', 'Both'])
    expect(x.franchise).toBe('Saga')
    expect(x.modes).toEqual(['Single player'])
    expect(x.screenshots).toEqual([{ thumb: expect.stringContaining('t_screenshot_med/sc1'), full: expect.stringContaining('t_1080p/sc1') }])
    expect(x.videos).toEqual([{ id: 'dQw4w9WgXcQ', name: 'Launch trailer' }])
    expect(x.similar).toEqual([{ igdbId: 5, name: 'Other', coverUrl: expect.stringContaining('co5') }])
  })

  it('reads the Steam store extras', () => {
    const x = parseSteamExtra({
      is_free: false,
      price_overview: { final_formatted: '$19.99' },
      metacritic: { score: 91, url: 'https://www.metacritic.com/game/x' },
      categories: [{ description: 'Single-player' }, { description: 'Full controller support' }],
      supported_languages: 'English<strong>*</strong>, French, German<strong>*</strong><br><strong>*</strong>languages with full audio support',
      achievements: { total: 42 },
      dlc: [1, 2, 3],
      pc_requirements: { minimum: '<strong>Minimum:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Windows 10<br></li><li><strong>Memory:</strong> 8 GB RAM</li></ul>' },
      website: 'http://insecure.example'
    })
    expect(x).toMatchObject({ price: '$19.99', achievements: 42, dlcCount: 3, website: null, metacritic: { score: 91 } })
    expect(x.languages).toEqual(['English', 'French', 'German'])
    expect(x.features).toEqual(['Single-player', 'Full controller support'])
    expect(x.requirements).toEqual({ minimum: 'OS: Windows 10\nMemory: 8 GB RAM', recommended: null })
    expect(parseSteamExtra({ is_free: true, pc_requirements: [] }).price).toBe('Free')
  })

  it('cleans up text', () => {
    expect(htmlToText('a&amp;b<br>c')).toBe('a&b\nc')
    expect(parseLanguages(undefined)).toEqual([])
    expect(newsExcerpt('[img]{STEAM_CLAN_IMAGE}/1/a.png[/img][b]Patch[/b] notes <i>here</i> https://x.y/z')).toBe('Patch notes here')
    expect(newsExcerpt('x'.repeat(300), 10)).toHaveLength(10)
  })
})

describe('DetailsService', () => {
  function setup(fail = false) {
    const db = openDatabase(':memory:').db
    const store = createSqliteStore(db)
    const [game, other] = store.upsert([
      { source: 'steam', externalId: '620', name: 'Portal 2', installPath: null, executablePath: null },
      { source: 'steam', externalId: '400', name: 'Portal', installPath: null, executablePath: null }
    ]).games
    db.prepare('UPDATE games SET igdb_id = 72 WHERE id = ?').run(game.id)
    const { fetch, calls } = fakeFetch([
      () => (fail ? new Response('down', { status: 503 }) : undefined),
      (c) => (c.url.includes('id.twitch.tv') ? json({ access_token: 'T', expires_in: 5_000_000 }) : undefined),
      (c) =>
        c.url.endsWith('/v4/games')
          ? json([{ aggregated_rating: 95, aggregated_rating_count: 30, similar_games: [{ id: 71, name: 'Portal' }, { id: 1, name: 'Elsewhere' }] }])
          : undefined,
      (c) => (c.url.endsWith('/game_time_to_beats') ? json([{ hastily: 30_000, normally: 40_000, completely: 80_000, count: 10 }]) : undefined),
      (c) => (c.url.includes('/api/appdetails') ? json({ 620: { success: true, data: { achievements: { total: 51 }, developers: ['Valve'] } } }) : undefined),
      (c) => (c.url.includes('/appreviews/') ? json({ success: 1, query_summary: { review_score_desc: 'Overwhelmingly Positive', total_positive: 98, total_reviews: 100 } }) : undefined),
      (c) =>
        c.url.includes('GetNewsForApp')
          ? json({ appnews: { newsitems: [{ title: 'Update', url: 'https://store.steampowered.com/news/1', date: 1_700_000_000, feedlabel: 'Community Announcements', contents: 'Fixes' }] } })
          : undefined
    ])
    const service = new DetailsService({
      db,
      store,
      fetchFn: fetch,
      getSettings: () => settings,
      steamAppIdFor: async (g) => g.externalId
    })
    return { service, game, other, calls }
  }

  it('combines IGDB and Steam, links owned similar games, and caches', async () => {
    const { service, game, other, calls } = setup()
    const d = await service.forGame(game.id)
    expect(d).toMatchObject({
      ratings: { critics: { score: 95, count: 30 }, steam: { label: 'Overwhelmingly Positive', positive: 98, total: 100 } },
      timeToBeat: { main: 30_000, extra: 40_000, completionist: 80_000, count: 10 },
      achievements: 51,
      developers: ['Valve'],
      sources: { igdb: true, steam: true }
    })
    expect(d!.news[0]).toMatchObject({ title: 'Update', date: 1_700_000_000_000, source: 'Community Announcements' })
    expect(d!.similar.map((s) => [s.name, s.libraryId])).toEqual([
      ['Portal', other.id],
      ['Elsewhere', null]
    ])
    const before = calls.length
    await service.forGame(game.id)
    expect(calls.length).toBe(before)
  })

  it('still answers when every service is down', async () => {
    const { service, game } = setup(true)
    const d = await service.forGame(game.id)
    expect(d).toMatchObject({ sources: { igdb: false, steam: false }, news: [], ratings: { critics: null, steam: null } })
  })
})
