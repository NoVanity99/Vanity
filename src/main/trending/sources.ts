import { createLimiter, requestJson, type FetchFn } from '../metadata/http'
import type { Igdb } from '../metadata/igdb'
import type { TwitchHelix } from '../metadata/twitch'

/** IGDB platform ID for PC (Microsoft Windows). */
export const PC_PLATFORM = 6
/** IGDB external_games sources used here. */
export const EXTERNAL_SOURCE = { steam: 1, gog: 5 } as const

/** How much each IGDB popularity type counts, matched by name (IGDB lists them at /popularity_types). */
const POPULARITY_WEIGHTS: { match: RegExp; weight: number }[] = [
  { match: /^playing$/i, weight: 0.35 },
  { match: /peak players/i, weight: 0.25 },
  { match: /^visits$/i, weight: 0.25 },
  { match: /hours watched/i, weight: 0.15 }
]
/** Used if /popularity_types can't be read: 1 = Visits, 3 = Playing (IGDB's long-standing IDs). */
const FALLBACK_TYPES = [
  { id: 3, weight: 0.6 },
  { id: 1, weight: 0.4 }
]
const PER_TYPE = 100

/**
 * Cross-platform popularity from IGDB's popularity primitives: for each
 * popularity type, the top games by value, scored by position (1 = top).
 * Returns game ID → 0–1 score.
 */
export async function fetchIgdbPopularity(igdb: Igdb): Promise<Map<number, number>> {
  let types: { id: number; weight: number }[]
  try {
    const all = await igdb.raw<{ id: number; name?: string }>('popularity_types', 'fields id,name; limit 100;')
    types = POPULARITY_WEIGHTS.flatMap(({ match, weight }) => {
      const t = all.find((x) => x.name && match.test(x.name))
      return t ? [{ id: t.id, weight }] : []
    })
    if (types.length === 0) types = FALLBACK_TYPES
  } catch {
    types = FALLBACK_TYPES
  }

  const scores = new Map<number, number>()
  let totalWeight = 0
  for (const { id, weight } of types) {
    const rows = await igdb.raw<{ game_id?: number; value?: number }>(
      'popularity_primitives',
      `fields game_id,value; sort value desc; limit ${PER_TYPE}; where popularity_type = ${Math.trunc(id)};`
    )
    if (rows.length === 0) continue
    totalWeight += weight
    rows.forEach((r, i) => {
      if (typeof r.game_id !== 'number') return
      scores.set(r.game_id, (scores.get(r.game_id) ?? 0) + weight * (1 - i / rows.length))
    })
  }
  if (totalWeight > 0) for (const [k, v] of scores) scores.set(k, v / totalWeight)
  return scores
}

export interface IgdbStoreGame {
  id: number
  name: string
  slug: string | null
  coverImageId: string | null
  /** Store page URLs from IGDB's websites and external_games. */
  urls: string[]
  steamAppId: string | null
  gogId: string | null
}

interface RawGame {
  id: number
  name?: string
  slug?: string
  first_release_date?: number
  hypes?: number
  artworks?: { image_id?: string }[]
  screenshots?: { image_id?: string }[]
  cover?: { image_id?: string }
  version_parent?: number
  genres?: { name?: string }[]
  websites?: { url?: string }[]
  external_games?: { uid?: string; url?: string; external_game_source?: number; category?: number }[]
}

export function toStoreGame(g: RawGame): IgdbStoreGame | null {
  if (!g.name || g.version_parent) return null
  const ext = g.external_games ?? []
  const uid = (source: number): string | null =>
    ext.find((e) => (e.external_game_source ?? e.category) === source && e.uid)?.uid ?? null
  const urls = [...(g.websites ?? []).map((w) => w.url), ...ext.map((e) => e.url)].filter((u): u is string => !!u)
  return {
    id: g.id,
    name: g.name,
    slug: g.slug ?? null,
    coverImageId: g.cover?.image_id ?? null,
    urls: [...new Set(urls)],
    steamAppId: uid(EXTERNAL_SOURCE.steam),
    gogId: uid(EXTERNAL_SOURCE.gog)
  }
}

/** Details for the given games, keeping only those released on PC. */
export async function fetchIgdbGames(igdb: Igdb, ids: number[]): Promise<IgdbStoreGame[]> {
  const out: IgdbStoreGame[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).map((n) => Math.trunc(n))
    if (chunk.length === 0) continue
    const rows = await igdb.queryWithSourceField<RawGame>(
      'games',
      (field) =>
        `fields name,slug,cover.image_id,version_parent,websites.url,external_games.uid,external_games.url,external_games.${field}; ` +
        `where id = (${chunk.join(',')}) & platforms = (${PC_PLATFORM}); limit 100;`
    )
    for (const r of rows) {
      const g = toStoreGame(r)
      if (g) out.push(g)
    }
  }
  return out
}

/** Current Steam players per app ID (keyless Steam Web API). Apps that fail are left out. */
export async function fetchSteamPlayers(fetchFn: FetchFn, appIds: string[]): Promise<Map<string, number>> {
  const limit = createLimiter(80)
  const result = new Map<string, number>()
  await Promise.all(
    appIds.map((id) =>
      limit(async () => {
        try {
          const url = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${encodeURIComponent(id)}`
          const res = await requestJson<{ response?: { player_count?: number; result?: number } }>(fetchFn, url, {}, 'Steam players')
          if (res.response?.result === 1 && typeof res.response.player_count === 'number') result.set(id, res.response.player_count)
        } catch {
          // A missing count just means no Steam signal for that game.
        }
      })
    )
  )
  return result
}

export interface TwitchTopGame {
  twitchId: string
  igdbId: number
  /** 1 = most watched. */
  rank: number
}

/** Twitch's most-watched categories that are games (Twitch links them to IGDB). */
export async function fetchTwitchTop(helix: TwitchHelix, count = 50): Promise<TwitchTopGame[]> {
  const res = await helix.get<{ data?: { id: string; igdb_id?: string }[] }>('/games/top', { first: String(count) })
  return (res.data ?? []).flatMap((g, i) => {
    const igdbId = Number(g.igdb_id)
    return g.igdb_id && Number.isFinite(igdbId) && igdbId > 0 ? [{ twitchId: g.id, igdbId, rank: i + 1 }] : []
  })
}

/** Approximate live viewers per Twitch game: the sum over its top 100 streams. */
export async function fetchTwitchViewers(helix: TwitchHelix, twitchIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  for (const id of twitchIds) {
    try {
      const res = await helix.get<{ data?: { viewer_count?: number }[] }>('/streams', { game_id: id, first: '100' })
      result.set(id, (res.data ?? []).reduce((sum, s) => sum + (s.viewer_count ?? 0), 0))
    } catch {
      // Leave this game without a viewer count.
    }
  }
  return result
}

export interface IgdbUpcomingGame extends IgdbStoreGame {
  releaseDate: string
  hype: number
  bannerImageId: string | null
  genres: string[]
}

/**
 * Upcoming PC games, most anticipated first (IGDB "hypes" = people following
 * a game before release). Only games with a known release date in the future.
 */
export async function fetchIgdbUpcoming(igdb: Igdb, nowMs: number, count = 200): Promise<IgdbUpcomingGame[]> {
  const now = Math.floor(nowMs / 1000)
  const rows = await igdb.queryWithSourceField<RawGame>(
    'games',
    (field) =>
      `fields name,slug,first_release_date,hypes,genres.name,cover.image_id,artworks.image_id,screenshots.image_id,version_parent,` +
      `websites.url,external_games.uid,external_games.url,external_games.${field}; ` +
      `where first_release_date > ${now} & platforms = (${PC_PLATFORM}) & hypes > 0 & version_parent = null; ` +
      `sort hypes desc; limit ${Math.trunc(count)};`
  )
  return rows.flatMap((r) => {
    const g = toStoreGame(r)
    if (!g || !r.first_release_date) return []
    return [
      {
        ...g,
        releaseDate: new Date(r.first_release_date * 1000).toISOString().slice(0, 10),
        hype: r.hypes ?? 0,
        bannerImageId: r.artworks?.find((a) => a.image_id)?.image_id ?? r.screenshots?.find((a) => a.image_id)?.image_id ?? null,
        genres: (r.genres ?? []).map((x) => x.name).filter((n): n is string => !!n).slice(0, 3)
      }
    ]
  })
}
