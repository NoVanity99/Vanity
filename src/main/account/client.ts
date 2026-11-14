import type { SyncRequest, SyncResponse } from '@shared/sync'
import type { FriendsList, FriendStats, GameFriend, SteamAchievement, SteamGame, SteamLink } from '@shared/types'
import type { FetchFn } from '../metadata/http'
import { AccountError } from './errors'
import { OFFLINE_MESSAGE } from './neonAuth'

export { AccountError }

export interface Me {
  id: string
  email: string | null
  /** Null until the account has picked a username. */
  username: string | null
}

/**
 * Thin client for the Vanity server (server/README.md). Every signed-in call carries a short-lived
 * token from Neon Auth: `getToken(true)` must return a brand-new one.
 */
export class AccountClient {
  constructor(
    private baseUrl: string,
    private fetchFn: FetchFn,
    private getToken: (fresh: boolean) => Promise<string | null> = async () => null
  ) {}

  private async send(method: string, path: string, body: unknown, token: string | null): Promise<Response> {
    try {
      return await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      throw new AccountError(OFFLINE_MESSAGE, false, true)
    }
  }

  private async call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    if (!this.baseUrl) throw new AccountError('Accounts are not set up in this build of Vanity.')
    let res = await this.send(method, path, body, auth ? await this.getToken(false) : null)
    // The token may have expired a moment ago: get a new one and try once more.
    if (res.status === 401 && auth) res = await this.send(method, path, body, await this.getToken(true))
    if (res.status === 204) return undefined as T
    let data: { error?: string; code?: string } & Record<string, unknown> = {}
    try {
      data = (await res.json()) as typeof data
    } catch {
      // Non-JSON (e.g. a proxy error page)
    }
    if (!res.ok) {
      if (res.status === 401 && auth) throw new AccountError(data.error ?? 'Please sign in again.', true)
      if (res.status >= 500) throw new AccountError(data.error ?? 'The Vanity server is having trouble. Try again in a moment.', false, true)
      throw new AccountError(data.error ?? `The Vanity server answered with an error (HTTP ${res.status}).`, false, false, typeof data.code === 'string' ? data.code : null)
    }
    return data as T
  }

  usernameAvailable = async (username: string) => (await this.call<{ available: boolean }>('GET', `/usernames/${encodeURIComponent(username)}`, undefined, false)).available
  me = async () => (await this.call<{ user: Me }>('GET', '/me')).user
  setUsername = async (username: string) => (await this.call<{ user: Me }>('PUT', '/me/username', { username })).user
  deleteAccount = () => this.call<void>('DELETE', '/me')

  heartbeat = (game: { gameKey: string; gameName: string; startedAt: number } | null) =>
    this.call<void>('PUT', '/presence', game ?? { gameKey: null })
  signOff = () => this.call<void>('DELETE', '/presence')
  syncStats = (games: { gameKey: string; gameName: string; playtimeSeconds: number; lastPlayedAt: number | null }[]) =>
    this.call<{ synced: number }>('PUT', '/stats', { games })

  /** Cloud-saved progress: sends what this device knows, gets the merged result back. */
  sync = (request: SyncRequest) => this.call<SyncResponse>('POST', '/sync', request)

  // Steam: the server holds the Steam key and does the asking.
  steamLink = () => this.call<{ configured: boolean; link: SteamLink | null }>('GET', '/steam/link')
  steamLinkSet = (input: string) => this.call<{ link: SteamLink }>('PUT', '/steam/link', { input })
  steamUnlink = () => this.call<void>('DELETE', '/steam/link')
  steamOpenIdStart = () => this.call<{ url: string }>('POST', '/steam/openid/start')
  steamOwnedGames = async () => (await this.call<{ games: SteamGame[] }>('GET', '/steam/owned-games')).games
  steamRecentGames = async () => (await this.call<{ games: SteamGame[] }>('GET', '/steam/recent-games')).games
  steamAchievements = async (appId: number) => (await this.call<{ achievements: SteamAchievement[] }>('GET', `/steam/achievements/${appId}`)).achievements
  steamAchievementSummary = () => this.call<{ unlocked: number; total: number; gamesChecked: number; gamesTotal: number; complete: boolean }>('GET', '/steam/achievements-summary')

  friends = () => this.call<FriendsList>('GET', '/friends')
  addFriend = (username: string) => this.call<{ status: 'pending' | 'accepted' }>('POST', '/friends/requests', { username })
  accept = (id: string) => this.call<void>('POST', `/friends/requests/${encodeURIComponent(id)}/accept`)
  decline = (id: string) => this.call<void>('DELETE', `/friends/requests/${encodeURIComponent(id)}`)
  removeFriend = (id: string) => this.call<void>('DELETE', `/friends/${encodeURIComponent(id)}`)
  friendStats = (id: string) => this.call<FriendStats>('GET', `/friends/${encodeURIComponent(id)}/stats`)
  gameFriends = async (key: string) => (await this.call<{ friends: GameFriend[] }>('GET', `/games/${encodeURIComponent(key)}/friends`)).friends
}
