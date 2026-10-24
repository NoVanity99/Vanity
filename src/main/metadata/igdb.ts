import type { MatchCandidate } from '@shared/types'
import { createLimiter, HttpError, requestJson, type FetchFn } from './http'
import { TwitchAppToken } from './twitch'

const API = 'https://api.igdb.com/v4'
/** IGDB's external source ID for Steam. */
const STEAM_SOURCE = 1

export interface IgdbDetails {
  id: number
  name: string
  summary: string | null
  genres: string[]
  releaseDate: string | null
  developer: string | null
  steamAppId: string | null
}

interface RawGame {
  id: number
  name: string
  summary?: string
  first_release_date?: number
  genres?: { name: string }[]
  involved_companies?: { developer?: boolean; company?: { name?: string } }[]
  cover?: { image_id?: string }
  version_parent?: number
  external_games?: { uid?: string; external_game_source?: number; category?: number }[]
}

/** Escapes a string for an Apicalypse query. */
function quote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function coverThumbUrl(imageId: string | undefined): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_cover_small/${imageId}.jpg` : null
}

function steamUid(g: RawGame): string | null {
  const ext = g.external_games?.find((e) => (e.external_game_source ?? e.category) === STEAM_SOURCE && e.uid)
  return ext?.uid ?? null
}

export function toDetails(g: RawGame): IgdbDetails {
  const developer = g.involved_companies?.find((c) => c.developer && c.company?.name)?.company?.name ?? null
  return {
    id: g.id,
    name: g.name,
    summary: g.summary?.trim() || null,
    genres: (g.genres ?? []).map((x) => x.name).filter(Boolean),
    releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
    developer,
    steamAppId: steamUid(g)
  }
}

const DETAIL_FIELDS =
  'name,summary,first_release_date,genres.name,involved_companies.developer,involved_companies.company.name,' +
  'cover.image_id,version_parent,external_games.uid,external_games.external_game_source'

/** IGDB client. Credentials are a Twitch app's client ID and secret (client-credentials OAuth). */
export class Igdb {
  readonly auth: TwitchAppToken
  // IGDB allows 4 requests per second.
  private limit = createLimiter(260)

  constructor(
    clientId: string,
    clientSecret: string,
    private fetchFn: FetchFn,
    now: () => number = Date.now,
    /** Share a token with other Twitch API clients. */
    auth?: TwitchAppToken
  ) {
    this.auth = auth ?? new TwitchAppToken(clientId, clientSecret, fetchFn, now)
  }

  private get clientId(): string {
    return this.auth.clientId
  }

  private accessToken(): Promise<string> {
    return this.auth.get()
  }

  private async query<T>(endpoint: string, body: string): Promise<T[]> {
    const send = async (): Promise<T[]> =>
      this.limit(async () =>
        requestJson<T[]>(
          this.fetchFn,
          `${API}/${endpoint}`,
          {
            method: 'POST',
            headers: { 'Client-ID': this.clientId, Authorization: `Bearer ${await this.accessToken()}`, Accept: 'application/json' },
            body
          },
          'IGDB'
        )
      )
    try {
      return await send()
    } catch (err) {
      // A token can be revoked before it expires; get a new one and retry once.
      if (err instanceof HttpError && err.status === 401) {
        this.auth.invalidate()
        return send()
      }
      throw err
    }
  }

  /**
   * IGDB renamed external_games.category to external_game_source in 2025. Use
   * the new name, and fall back to the old one if the API rejects it (400).
   * `build` receives the field name to use.
   */
  async queryWithSourceField<T>(endpoint: string, build: (field: string) => string): Promise<T[]> {
    try {
      return await this.query<T>(endpoint, build('external_game_source'))
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) return this.query<T>(endpoint, build('category'))
      throw err
    }
  }

  async gameIdBySteamAppId(appId: string): Promise<number | null> {
    const rows = await this.queryWithSourceField<{ game?: number }>(
      'external_games',
      (field) => `fields game; where uid = ${quote(appId)} & ${field} = ${STEAM_SOURCE}; limit 1;`
    )
    return rows[0]?.game ?? null
  }

  async search(term: string): Promise<MatchCandidate[]> {
    const rows = await this.queryWithSourceField<RawGame>(
      'games',
      (field) =>
        `search ${quote(term)}; fields name,first_release_date,cover.image_id,version_parent,external_games.uid,external_games.${field}; limit 20;`
    )
    return rows
      .filter((g) => !g.version_parent) // skip editions/bundles that point at a parent game
      .map((g) => ({
        provider: 'igdb' as const,
        id: g.id,
        name: g.name,
        year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
        thumbUrl: coverThumbUrl(g.cover?.image_id),
        steamAppId: steamUid(g)
      }))
  }

  async details(id: number): Promise<IgdbDetails | null> {
    const rows = await this.queryWithSourceField<RawGame>(
      'games',
      (field) => `fields ${DETAIL_FIELDS.replace('external_games.external_game_source', `external_games.${field}`)}; where id = ${Math.trunc(id)}; limit 1;`
    )
    return rows[0] ? toDetails(rows[0]) : null
  }

  /** Throws when the client ID or secret is wrong. */
  async checkCredentials(): Promise<void> {
    this.auth.invalidate()
    await this.accessToken()
  }

  /** Runs a raw Apicalypse query. */
  raw<T>(endpoint: string, body: string): Promise<T[]> {
    return this.query<T>(endpoint, body)
  }
}
