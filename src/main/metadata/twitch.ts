import { createLimiter, HttpError, requestJson, type FetchFn } from './http'

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const HELIX = 'https://api.twitch.tv/helix'

/**
 * An app access token for a Twitch developer application (client-credentials
 * flow). IGDB and the Twitch Helix API both accept it.
 */
export class TwitchAppToken {
  private token: { value: string; expiresAt: number } | null = null
  private request: Promise<string> | null = null

  constructor(
    readonly clientId: string,
    private clientSecret: string,
    private fetchFn: FetchFn,
    private now: () => number = Date.now
  ) {}

  async get(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value
    this.request ??= (async () => {
      try {
        const params = new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials'
        })
        const res = await requestJson<{ access_token: string; expires_in: number }>(
          this.fetchFn,
          `${TOKEN_URL}?${params}`,
          { method: 'POST' },
          'Twitch login'
        )
        this.token = { value: res.access_token, expiresAt: this.now() + res.expires_in * 1000 }
        return res.access_token
      } finally {
        this.request = null
      }
    })()
    return this.request
  }

  /** Forget the token (after a 401), so the next call gets a new one. */
  invalidate(): void {
    this.token = null
  }
}

/** Minimal Twitch Helix client for top games and viewer counts. */
export class TwitchHelix {
  // Helix allows 800 requests per minute for app tokens; stay well under.
  private limit = createLimiter(120)

  constructor(
    private auth: TwitchAppToken,
    private fetchFn: FetchFn
  ) {}

  async get<T>(path: string, params: Record<string, string | string[]>): Promise<T> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) for (const item of [v].flat()) qs.append(k, item)
    const send = async (): Promise<T> =>
      this.limit(async () =>
        requestJson<T>(
          this.fetchFn,
          `${HELIX}${path}?${qs}`,
          { headers: { 'Client-Id': this.auth.clientId, Authorization: `Bearer ${await this.auth.get()}` } },
          'Twitch'
        )
      )
    try {
      return await send()
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        this.auth.invalidate()
        return send()
      }
      throw err
    }
  }
}
