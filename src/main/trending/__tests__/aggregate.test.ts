import { describe, expect, it } from 'vitest'
import { extractStores, popularityStat, rankTrending, type Signals } from '../aggregate'
import type { IgdbStoreGame } from '../sources'

const game = (id: number, name: string, over: Partial<IgdbStoreGame> = {}): IgdbStoreGame => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  coverImageId: `co${id}`,
  urls: [],
  steamAppId: null,
  gogId: null,
  ...over
})

const signals = (over: Partial<Signals> = {}): Signals => ({
  igdb: new Map(),
  twitchRank: new Map(),
  twitchViewers: new Map(),
  steamPlayers: new Map(),
  ...over
})

describe('extractStores', () => {
  it('collects one link per store from URLs and IGDB IDs, in a stable order', () => {
    const stores = extractStores(
      game(1, 'Cyberpunk 2077', {
        urls: [
          'https://www.gog.com/en/game/cyberpunk_2077',
          'https://store.epicgames.com/p/cyberpunk-2077',
          'https://store.steampowered.com/app/1091500',
          'https://store.steampowered.com/app/1091500/Cyberpunk_2077/',
          'https://twitter.com/CyberpunkGame'
        ],
        gogId: '1423049311'
      })
    )
    expect(stores.map((s) => s.launcher)).toEqual(['steam', 'epic', 'gog'])
    expect(stores.find((s) => s.launcher === 'gog')).toEqual({
      launcher: 'gog',
      storeId: '1423049311',
      deepLink: 'goggalaxy://openGameView/1423049311',
      webUrl: 'https://www.gog.com/en/game/cyberpunk_2077'
    })
  })

  it('adds Steam from the app ID even without a store URL', () => {
    expect(extractStores(game(2, 'Portal 2', { steamAppId: '620' }))).toEqual([
      { launcher: 'steam', storeId: '620', deepLink: 'steam://store/620', webUrl: 'https://store.steampowered.com/app/620' }
    ])
  })
})

describe('rankTrending', () => {
  const steamOnly = game(1, 'Counter-Strike 2', { steamAppId: '730' })
  const battlenet = game(2, 'Overwatch 2', { urls: ['https://shop.battle.net/en-us/product/overwatch'] })
  const quiet = game(3, 'Quiet Indie', { steamAppId: '999' })
  const noStore = game(4, 'Console Only')

  it('blends IGDB with the stronger live signal and skips games without stores', () => {
    const ranked = rankTrending(
      [quiet, battlenet, steamOnly, noStore],
      signals({
        igdb: new Map([[1, 0.9], [2, 0.7], [3, 0.95], [4, 1]]),
        steamPlayers: new Map([[1, 1_400_000], [3, 40]]),
        twitchViewers: new Map([[2, 60_000]]),
        twitchRank: new Map([[2, 3]])
      })
    )
    expect(ranked.map((g) => g.title)).toEqual(['Counter-Strike 2', 'Overwatch 2', 'Quiet Indie'])
    expect(ranked.map((g) => g.rank)).toEqual([1, 2, 3])
    expect(ranked[0]).toMatchObject({
      id: 1,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1.jpg',
      popularityStat: { kind: 'players', value: 1_400_000 }
    })
    expect(ranked[1].popularityStat).toEqual({ kind: 'viewers', value: 60_000 })
  })

  it('caps the list', () => {
    const many = Array.from({ length: 60 }, (_, i) => game(i + 1, `Game ${i}`, { steamAppId: String(i + 1) }))
    const ranked = rankTrending(many, signals({ igdb: new Map(many.map((g, i) => [g.id, 1 - i / 100])) }), 40)
    expect(ranked).toHaveLength(40)
  })

  it('picks a readable stat', () => {
    expect(popularityStat(1, signals())).toEqual({ kind: 'igdb', value: null })
    expect(popularityStat(1, signals({ steamPlayers: new Map([[1, 500]]), twitchViewers: new Map([[1, 9000]]) }))).toEqual({ kind: 'viewers', value: 9000 })
  })
})
