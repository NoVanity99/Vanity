import type { ArtworkKind, ArtworkOption, MatchCandidate } from '@shared/types'
import { createLimiter, HttpError, requestJson, type FetchFn } from './http'

const BASE = 'https://www.steamgriddb.com/api/v2'

interface SgdbGame {
  id: number
  name: string
  release_date?: number | null
}

interface SgdbAsset {
  id: number
  url: string
  thumb: string
  width: number
  height: number
  nsfw?: boolean
  humor?: boolean
  epilepsy?: boolean
}

interface SgdbResponse<T> {
  success: boolean
  data: T
  errors?: string[]
}

const ENDPOINT: Record<ArtworkKind, string> = { cover: 'grids', hero: 'heroes', logo: 'logos', icon: 'icons' }

/** Query parameters per kind: static images only, no NSFW/joke art, portrait covers. */
const PARAMS: Record<ArtworkKind, Record<string, string>> = {
  cover: { dimensions: '600x900,342x482,660x930', types: 'static', nsfw: 'false', humor: 'false' },
  hero: { types: 'static', nsfw: 'false', humor: 'false' },
  logo: { types: 'static', nsfw: 'false', humor: 'false' },
  icon: { types: 'static', nsfw: 'false', humor: 'false' }
}

/** SteamGridDB API v2 client: game lookup and artwork. https://www.steamgriddb.com/api/v2 */
export class SteamGridDb {
  private limit = createLimiter(150)

  constructor(
    private apiKey: string,
    private fetchFn: FetchFn
  ) {}

  private async get<T>(path: string, params?: Record<string, string>): Promise<T | null> {
    const qs = params ? `?${new URLSearchParams(params)}` : ''
    try {
      const res = await this.limit(() =>
        requestJson<SgdbResponse<T>>(
          this.fetchFn,
          `${BASE}${path}${qs}`,
          { headers: { Authorization: `Bearer ${this.apiKey}` } },
          'SteamGridDB'
        )
      )
      return res.success ? res.data : null
    } catch (err) {
      // 404 means "no such game / no assets", not a failure.
      if (err instanceof HttpError && err.status === 404) return null
      throw err
    }
  }

  async gameBySteamAppId(appId: string): Promise<SgdbGame | null> {
    return this.get<SgdbGame>(`/games/steam/${encodeURIComponent(appId)}`)
  }

  async search(term: string): Promise<MatchCandidate[]> {
    const games = (await this.get<SgdbGame[]>(`/search/autocomplete/${encodeURIComponent(term)}`)) ?? []
    return games.map((g) => ({
      provider: 'steamgriddb' as const,
      id: g.id,
      name: g.name,
      year: g.release_date ? new Date(g.release_date * 1000).getUTCFullYear() : null,
      thumbUrl: null,
      steamAppId: null
    }))
  }

  /** Artwork options for a game, best-rated first (the API's default order). */
  async artwork(kind: ArtworkKind, gameId: number): Promise<ArtworkOption[]> {
    const assets = (await this.get<SgdbAsset[]>(`/${ENDPOINT[kind]}/game/${gameId}`, PARAMS[kind])) ?? []
    return assets
      .filter((a) => !a.nsfw && !a.humor && !a.epilepsy && a.url)
      .map((a) => ({ id: a.id, url: a.url, thumbUrl: a.thumb || a.url, width: a.width, height: a.height }))
  }

  /** Throws HttpError 401 when the key is wrong. */
  async checkKey(): Promise<void> {
    await this.get<SgdbGame>('/games/id/1')
  }
}
