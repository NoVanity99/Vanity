import type { GameDetails, Rating } from '@shared/types'
import { createLimiter, requestJson, type FetchFn } from '../metadata/http'
import type { Igdb } from '../metadata/igdb'
import { decodeEntities } from '../metadata/steamStore'

const IMG = 'https://images.igdb.com/igdb/image/upload'

// ---- IGDB ---------------------------------------------------------------------

export interface IgdbExtra {
  critics: Rating | null
  players: Rating | null
  storyline: string | null
  developers: string[]
  publishers: string[]
  franchise: string | null
  modes: string[]
  perspectives: string[]
  themes: string[]
  platforms: string[]
  screenshots: { thumb: string; full: string }[]
  videos: { id: string; name: string }[]
  similar: { igdbId: number; name: string; coverUrl: string | null }[]
}

interface Named {
  name?: string
}
interface RawExtra {
  aggregated_rating?: number
  aggregated_rating_count?: number
  rating?: number
  rating_count?: number
  storyline?: string
  game_modes?: Named[]
  player_perspectives?: Named[]
  themes?: Named[]
  platforms?: Named[]
  franchises?: Named[]
  collections?: Named[]
  involved_companies?: { developer?: boolean; publisher?: boolean; company?: Named }[]
  screenshots?: { image_id?: string }[]
  artworks?: { image_id?: string }[]
  videos?: { video_id?: string; name?: string }[]
  similar_games?: { id: number; name?: string; cover?: { image_id?: string } }[]
}

const names = (xs: Named[] | undefined): string[] => [...new Set((xs ?? []).map((x) => x.name?.trim()).filter((n): n is string => !!n))]

function rating(score: number | undefined, count: number | undefined): Rating | null {
  return typeof score === 'number' && score > 0 && count ? { score: Math.round(score), count } : null
}

/** A YouTube video ID, or null for anything else (IGDB only lists YouTube videos). */
export function youtubeId(id: string | undefined): string | null {
  return id && /^[\w-]{6,20}$/.test(id) ? id : null
}

export function parseIgdbExtra(g: RawExtra): IgdbExtra {
  const companies = g.involved_companies ?? []
  const pictures = [...(g.screenshots ?? []), ...(g.artworks ?? [])].filter((s) => s.image_id)
  return {
    critics: rating(g.aggregated_rating, g.aggregated_rating_count),
    players: rating(g.rating, g.rating_count),
    storyline: g.storyline?.trim() || null,
    developers: names(companies.filter((c) => c.developer).map((c) => c.company ?? {})),
    publishers: names(companies.filter((c) => c.publisher).map((c) => c.company ?? {})),
    franchise: names(g.franchises)[0] ?? names(g.collections)[0] ?? null,
    modes: names(g.game_modes),
    perspectives: names(g.player_perspectives),
    themes: names(g.themes),
    platforms: names(g.platforms),
    screenshots: pictures.slice(0, 12).map((s) => ({ thumb: `${IMG}/t_screenshot_med/${s.image_id}.jpg`, full: `${IMG}/t_1080p/${s.image_id}.jpg` })),
    videos: (g.videos ?? []).flatMap((v) => {
      const id = youtubeId(v.video_id)
      return id ? [{ id, name: v.name?.trim() || 'Trailer' }] : []
    }).slice(0, 6),
    similar: (g.similar_games ?? [])
      .filter((s) => s.name)
      .slice(0, 10)
      .map((s) => ({ igdbId: s.id, name: s.name!, coverUrl: s.cover?.image_id ? `${IMG}/t_cover_big/${s.cover.image_id}.jpg` : null }))
  }
}

const EXTRA_FIELDS = [
  'aggregated_rating',
  'aggregated_rating_count',
  'rating',
  'rating_count',
  'storyline',
  'game_modes.name',
  'player_perspectives.name',
  'themes.name',
  'platforms.name',
  'franchises.name',
  'collections.name',
  'involved_companies.developer',
  'involved_companies.publisher',
  'involved_companies.company.name',
  'screenshots.image_id',
  'artworks.image_id',
  'videos.video_id',
  'videos.name',
  'similar_games.name',
  'similar_games.cover.image_id'
].join(',')

export async function fetchIgdbExtra(igdb: Igdb, igdbId: number): Promise<IgdbExtra | null> {
  const rows = await igdb.raw<RawExtra>('games', `fields ${EXTRA_FIELDS}; where id = ${Math.trunc(igdbId)}; limit 1;`)
  return rows[0] ? parseIgdbExtra(rows[0]) : null
}

export async function fetchTimeToBeat(igdb: Igdb, igdbId: number): Promise<GameDetails['timeToBeat']> {
  const rows = await igdb.raw<{ hastily?: number; normally?: number; completely?: number; count?: number }>(
    'game_time_to_beats',
    `fields hastily,normally,completely,count; where game_id = ${Math.trunc(igdbId)}; limit 1;`
  )
  const r = rows[0]
  if (!r) return null
  const n = (v: number | undefined): number | null => (typeof v === 'number' && v > 0 ? v : null)
  const result = { main: n(r.hastily), extra: n(r.normally), completionist: n(r.completely), count: r.count ?? 0 }
  return result.main || result.extra || result.completionist ? result : null
}

// ---- Steam ---------------------------------------------------------------------

export interface SteamExtra {
  metacritic: { score: number; url: string | null } | null
  features: string[]
  languages: string[]
  achievements: number | null
  dlcCount: number | null
  price: string | null
  requirements: { minimum: string | null; recommended: string | null } | null
  website: string | null
  developers: string[]
  publishers: string[]
  screenshots: { thumb: string; full: string }[]
}

interface RawAppDetails {
  is_free?: boolean
  metacritic?: { score?: number; url?: string }
  categories?: { description?: string }[]
  supported_languages?: string
  achievements?: { total?: number }
  dlc?: number[]
  price_overview?: { final_formatted?: string }
  pc_requirements?: { minimum?: string; recommended?: string } | unknown[]
  website?: string | null
  developers?: string[]
  publishers?: string[]
  screenshots?: { path_thumbnail?: string; path_full?: string }[]
}

/** Steam's HTML snippets as plain text: line breaks kept, tags and entities removed. */
export function htmlToText(html: string | undefined): string | null {
  if (!html) return null
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(li|p|ul|div|h\d)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return text || null
}

/** "English<strong>*</strong>, French<br><strong>*</strong>languages with full audio support" → ["English", "French"] */
export function parseLanguages(html: string | undefined): string[] {
  if (!html) return []
  const list = html.split(/<br\s*\/?>/i)[0]
  return [...new Set(htmlToText(list)?.replace(/\*/g, '').split(',').map((l) => l.trim()).filter(Boolean) ?? [])]
}

const httpsUrl = (u: string | null | undefined): string | null => (u && /^https:\/\//i.test(u) ? u : null)

export function parseSteamExtra(d: RawAppDetails): SteamExtra {
  const req = Array.isArray(d.pc_requirements) ? undefined : d.pc_requirements
  const minimum = htmlToText(req?.minimum)?.replace(/^Minimum:\s*/i, '') ?? null
  const recommended = htmlToText(req?.recommended)?.replace(/^Recommended:\s*/i, '') ?? null
  return {
    metacritic: d.metacritic?.score ? { score: d.metacritic.score, url: httpsUrl(d.metacritic.url) } : null,
    features: [...new Set((d.categories ?? []).map((c) => c.description?.trim()).filter((c): c is string => !!c))],
    languages: parseLanguages(d.supported_languages),
    achievements: d.achievements?.total || null,
    dlcCount: d.dlc?.length || null,
    price: d.is_free ? 'Free' : (d.price_overview?.final_formatted ?? null),
    requirements: minimum || recommended ? { minimum, recommended } : null,
    website: httpsUrl(d.website),
    developers: d.developers ?? [],
    publishers: d.publishers ?? [],
    screenshots: (d.screenshots ?? [])
      .filter((s) => httpsUrl(s.path_full) && httpsUrl(s.path_thumbnail))
      .slice(0, 12)
      .map((s) => ({ thumb: s.path_thumbnail!, full: s.path_full! }))
  }
}

// The store API is limited to roughly 200 requests per 5 minutes.
const storeLimit = createLimiter(1600)

export async function fetchSteamExtra(fetchFn: FetchFn, appId: string): Promise<SteamExtra | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=english`
  const res = await storeLimit(() => requestJson<Record<string, { success?: boolean; data?: RawAppDetails }>>(fetchFn, url, {}, 'Steam store'))
  const entry = res[appId]
  return entry?.success && entry.data ? parseSteamExtra(entry.data) : null
}

export async function fetchSteamReviews(fetchFn: FetchFn, appId: string): Promise<GameDetails['ratings']['steam']> {
  const url = `https://store.steampowered.com/appreviews/${encodeURIComponent(appId)}?json=1&language=all&purchase_type=all&num_per_page=0`
  const res = await requestJson<{ success?: number; query_summary?: { review_score_desc?: string; total_positive?: number; total_reviews?: number } }>(
    fetchFn,
    url,
    {},
    'Steam reviews'
  )
  const q = res.query_summary
  if (res.success !== 1 || !q?.total_reviews) return null
  return { label: q.review_score_desc ?? 'User reviews', positive: q.total_positive ?? 0, total: q.total_reviews }
}

/** Steam news text: no BBCode, HTML, or image placeholders, cut to a short excerpt. */
export function newsExcerpt(contents: string | undefined, max = 240): string {
  if (!contents) return ''
  const text = decodeEntities(
    contents
      .replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ')
      .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, ' ')
      .replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export async function fetchSteamNews(fetchFn: FetchFn, appId: string): Promise<GameDetails['news']> {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(appId)}&count=6&maxlength=600&format=json`
  const res = await requestJson<{ appnews?: { newsitems?: { title?: string; url?: string; date?: number; feedlabel?: string; contents?: string }[] } }>(
    fetchFn,
    url,
    {},
    'Steam news'
  )
  return (res.appnews?.newsitems ?? []).flatMap((n) => {
    const link = httpsUrl(n.url)
    if (!n.title || !link || !n.date) return []
    return [{ title: decodeEntities(n.title).trim(), url: link, date: n.date * 1000, source: n.feedlabel?.trim() || 'Steam', excerpt: newsExcerpt(n.contents) }]
  })
}
