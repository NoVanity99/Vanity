import type { PopularityStat, StoreLauncher, StoreLink, TrendingGame, UpcomingGame } from '@shared/types'
import { ALL_LAUNCHERS, buildStoreLink, storeFromUrl } from './launcherLinks'
import type { IgdbStoreGame, IgdbUpcomingGame } from './sources'

export interface Signals {
  /** IGDB popularity, game ID → 0–1. */
  igdb: Map<number, number>
  /** Twitch rank (1 = most watched), by IGDB game ID. */
  twitchRank: Map<number, number>
  /** Live Twitch viewers, by IGDB game ID. */
  twitchViewers: Map<number, number>
  /** Current Steam players, by IGDB game ID. */
  steamPlayers: Map<number, number>
}

/** Weight of IGDB's ranking vs. the strongest live signal (Steam players or Twitch viewers). */
const IGDB_WEIGHT = 0.55
const LIVE_WEIGHT = 0.45
/** Below this many current Steam players, show the Twitch or IGDB stat instead. */
const MIN_PLAYERS_TO_SHOW = 1000

export function coverUrl(imageId: string | null): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${imageId}.jpg` : null
}

/** One link per store, from the game's store URLs and the IDs IGDB knows, in a stable order. */
export function extractStores(game: IgdbStoreGame): StoreLink[] {
  const found = new Map<StoreLauncher, { id: string; webUrl: string }>()
  for (const url of game.urls) {
    const s = storeFromUrl(url)
    if (s && !found.has(s.launcher)) found.set(s.launcher, { id: s.id, webUrl: s.webUrl })
  }
  if (game.steamAppId && /^\d+$/.test(game.steamAppId)) {
    // IGDB's Steam ID is more reliable than one parsed from a URL.
    const fromUrl = found.get('steam')
    found.set('steam', { id: game.steamAppId, webUrl: fromUrl?.id === game.steamAppId ? fromUrl.webUrl : `https://store.steampowered.com/app/${game.steamAppId}` })
  }
  if (game.gogId && /^\d+$/.test(game.gogId)) {
    // Galaxy needs the numeric ID; keep the slug page (if any) for the browser.
    const page = found.get('gog')?.webUrl ?? `https://www.gog.com/en/games?query=${encodeURIComponent(game.name)}`
    found.set('gog', { id: game.gogId, webUrl: page })
  }
  return ALL_LAUNCHERS.filter((l) => found.has(l)).map((l) => {
    const { id, webUrl } = found.get(l)!
    return buildStoreLink(l, id, webUrl, game.slug ?? undefined)
  })
}

function logNorm(value: number | undefined, max: number): number {
  if (!value || max <= 0) return 0
  return Math.log10(1 + value) / Math.log10(1 + max)
}

export function popularityStat(gameId: number, s: Signals): PopularityStat {
  const players = s.steamPlayers.get(gameId)
  const viewers = s.twitchViewers.get(gameId)
  if (players !== undefined && players >= MIN_PLAYERS_TO_SHOW && players >= (viewers ?? 0)) return { kind: 'players', value: players }
  if (viewers) return { kind: 'viewers', value: viewers }
  if (players) return { kind: 'players', value: players }
  return { kind: 'igdb', value: null }
}

/**
 * Blends the signals into one ranking. IGDB gives the cross-platform base;
 * the live signal is whichever of Steam players or Twitch viewers is stronger
 * for that game, so games off Steam (Battle.net, Epic exclusives) aren't
 * penalised for having no player count. Games with no known store are left out.
 */
export function rankTrending(games: IgdbStoreGame[], s: Signals, limit = 40): TrendingGame[] {
  const maxPlayers = Math.max(0, ...s.steamPlayers.values())
  const maxViewers = Math.max(0, ...s.twitchViewers.values())
  const twitchCount = Math.max(1, ...s.twitchRank.values())

  return games
    .map((g) => {
      const stores = extractStores(g)
      const twitch = Math.max(
        logNorm(s.twitchViewers.get(g.id), maxViewers),
        s.twitchRank.has(g.id) ? 0.8 * (1 - (s.twitchRank.get(g.id)! - 1) / twitchCount) : 0
      )
      const live = Math.max(logNorm(s.steamPlayers.get(g.id), maxPlayers), twitch)
      const score = IGDB_WEIGHT * (s.igdb.get(g.id) ?? 0) + LIVE_WEIGHT * live
      return { g, stores, score }
    })
    .filter((x) => x.stores.length > 0 && x.score > 0)
    .sort((a, b) => b.score - a.score || a.g.name.localeCompare(b.g.name))
    .slice(0, limit)
    .map(({ g, stores }, i) => ({
      id: g.id,
      title: g.name,
      coverUrl: coverUrl(g.coverImageId),
      rank: i + 1,
      popularityStat: popularityStat(g.id, s),
      stores
    }))
}

export function bannerUrl(imageId: string | null): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_1080p/${imageId}.jpg` : null
}

/** Upcoming games for the banner: the most anticipated ones that can be opened in at least one store, ranked by hype. */
export function toUpcoming(games: IgdbUpcomingGame[], limit = 30): UpcomingGame[] {
  return games
    .map((g) => ({
      id: g.id,
      title: g.name,
      bannerUrl: bannerUrl(g.bannerImageId),
      coverUrl: coverUrl(g.coverImageId),
      releaseDate: g.releaseDate,
      hype: g.hype,
      stores: extractStores(g),
      hypeRank: 0,
      genres: g.genres ?? []
    }))
    .filter((g) => g.stores.length > 0 && (g.bannerUrl || g.coverUrl))
    .sort((a, b) => b.hype - a.hype || a.releaseDate.localeCompare(b.releaseDate))
    .slice(0, limit)
    .map((g, i) => ({ ...g, hypeRank: i + 1 }))
}
