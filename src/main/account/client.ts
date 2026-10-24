import type { FriendsList, FriendStats, GameFriend } from '@shared/types'
import type { FetchFn } from '../metadata/http'

/** A failure with a message that can be shown to the user. `signedOut` means the token is no longer valid. */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly signedOut = false
  ) {
    super(message)
  }
}

export interface Session {
  token: string
  user: { id: string; username: string }
}

/** Thin client for the Vanity account server (server/README.md). */
export class AccountClient {
  constructor(
    private baseUrl: string,
    private fetchFn: FetchFn,
    private token: string | null = null
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    if (!this.baseUrl) throw new AccountError('No account server is set. Add its URL on the Account page.')
    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(auth && this.token ? { authorization: `Bearer ${this.token}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      throw new AccountError(`Couldn't reach the Vanity server at ${this.baseUrl}.`)
    }
    if (res.status === 204) return undefined as T
    let data: { error?: string } & Record<string, unknown> = {}
    try {
      data = (await res.json()) as typeof data
    } catch {
      // Non-JSON (e.g. a proxy error page)
    }
    if (!res.ok) {
      if (res.status === 401 && auth) throw new AccountError(data.error ?? 'Please sign in again.', true)
      throw new AccountError(data.error ?? `The Vanity server answered with an error (HTTP ${res.status}).`)
    }
    return data as T
  }

  /** Checks that the URL is a Vanity server. */
  async ping(): Promise<void> {
    const r = await this.call<{ name?: string }>('GET', '/', undefined, false)
    if (r?.name !== 'vanity-api') throw new AccountError("That address answered, but it isn't a Vanity account server.")
  }

  register = (username: string, password: string) => this.call<Session>('POST', '/auth/register', { username, password }, false)
  login = (username: string, password: string) => this.call<Session>('POST', '/auth/login', { username, password }, false)
  me = () => this.call<{ user: { id: string; username: string } }>('GET', '/me')
  deleteAccount = () => this.call<void>('DELETE', '/me')

  heartbeat = (game: { gameKey: string; gameName: string; startedAt: number } | null) =>
    this.call<void>('PUT', '/presence', game ?? { gameKey: null })
  signOff = () => this.call<void>('DELETE', '/presence')
  syncStats = (games: { gameKey: string; gameName: string; playtimeSeconds: number; lastPlayedAt: number | null }[]) =>
    this.call<{ synced: number }>('PUT', '/stats', { games })

  friends = () => this.call<FriendsList>('GET', '/friends')
  addFriend = (username: string) => this.call<{ status: 'pending' | 'accepted' }>('POST', '/friends/requests', { username })
  accept = (id: string) => this.call<void>('POST', `/friends/requests/${encodeURIComponent(id)}/accept`)
  decline = (id: string) => this.call<void>('DELETE', `/friends/requests/${encodeURIComponent(id)}`)
  removeFriend = (id: string) => this.call<void>('DELETE', `/friends/${encodeURIComponent(id)}`)
  friendStats = (id: string) => this.call<FriendStats>('GET', `/friends/${encodeURIComponent(id)}/stats`)
  gameFriends = async (key: string) => (await this.call<{ friends: GameFriend[] }>('GET', `/games/${encodeURIComponent(key)}/friends`)).friends
}
