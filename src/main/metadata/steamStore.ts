import type { ArtworkKind } from '@shared/types'
import { createLimiter, requestJson, type FetchFn } from './http'

export interface SteamDetails {
  name: string
  description: string | null
  genres: string[]
  releaseDate: string | null
  developer: string | null
}

interface AppDetailsResponse {
  [appId: string]: {
    success: boolean
    data?: {
      name: string
      short_description?: string
      genres?: { description: string }[]
      developers?: string[]
      release_date?: { date?: string; coming_soon?: boolean }
    }
  }
}

const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

/** Steam's public artwork for an app, used when SteamGridDB has nothing (or no key is set). Icons aren't public. */
export function steamArtworkUrl(kind: ArtworkKind, appId: string): string | null {
  const id = encodeURIComponent(appId)
  switch (kind) {
    case 'cover':
      return `${CDN}/${id}/library_600x900_2x.jpg`
    case 'hero':
      return `${CDN}/${id}/library_hero.jpg`
    case 'logo':
      return `${CDN}/${id}/logo.png`
    default:
      return null
  }
}

/** "18 Apr, 2011" / "Apr 18, 2011" → "2011-04-18"; returns null if unparseable. */
export function parseSteamDate(text: string | undefined): string | null {
  if (!text) return null
  const t = Date.parse(`${text.replace(',', '')} UTC`)
  if (Number.isNaN(t)) {
    const year = /\b(19|20)\d{2}\b/.exec(text)
    return year ? `${year[0]}-01-01` : null
  }
  return new Date(t).toISOString().slice(0, 10)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Decodes the HTML entities Steam leaves in its plain-text fields. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Keyless Steam Store API, for Steam games' description, genres, date and developer. */
export class SteamStore {
  // The store API is limited to roughly 200 requests per 5 minutes.
  private limit = createLimiter(1600)

  constructor(private fetchFn: FetchFn) {}

  async details(appId: string): Promise<SteamDetails | null> {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&l=english`
    const res = await this.limit(() => requestJson<AppDetailsResponse>(this.fetchFn, url, {}, 'Steam store'))
    const entry = res[appId]
    if (!entry?.success || !entry.data) return null
    const d = entry.data
    return {
      name: d.name,
      description: d.short_description ? decodeEntities(d.short_description).trim() || null : null,
      genres: (d.genres ?? []).map((g) => g.description).filter(Boolean),
      releaseDate: d.release_date?.coming_soon ? null : parseSteamDate(d.release_date?.date),
      developer: d.developers?.[0] ?? null
    }
  }
}
