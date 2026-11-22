import type { SyncRequest, SyncResponse } from '@shared/sync'
import type { VoiceSignal, VoiceUpdate } from '@shared/voiceProtocol'
import type { GifResult, GroupChat, GroupMessage, GroupPage } from '@shared/groups'
import type { ProfileStyle } from '../../shared/profileStyle'
import type { ChatMessage, ChatPage, FriendsList, FriendStats, GameFriend, PublicUser, SteamAchievement, SteamGame, SteamLink } from '@shared/types'
import type { FetchFn } from '../metadata/http'
import { AccountError } from './errors'
import { OFFLINE_MESSAGE } from './neonAuth'

export { AccountError }

export interface Me {
  id: string
  email: string | null
  /** Null until the account has picked a username. */
  username: string | null
  avatar: string | null
  bio: string
  style?: unknown
  statsVisibility?: string
  verified: boolean
  admin: boolean
  usernameChangeAt?: number | null
  standing?: { banned?: boolean; reason?: string; timeoutUntil?: number | null }
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

  /** A request from one of the app's screens (the caller has checked the path is an allowed one). */
  request = <T>(method: string, path: string, body?: unknown) => this.call<T>(method, path, body)
  usernameAvailable = async (username: string) => (await this.call<{ available: boolean }>('GET', `/usernames/${encodeURIComponent(username)}`, undefined, false)).available
  /** True/false when the server knows; null when it can't tell (Neon Auth then decides at sign-up). */
  emailInUse = async (email: string) => (await this.call<{ inUse: boolean | null }>('POST', '/emails/check', { email }, false)).inUse ?? null
  /** Signs in with a username: the server finds the email privately and asks Neon Auth (see POST /auth/sign-in). */
  signInWithUsername = (username: string, password: string) => this.call<{ user: { id: string; email: string; name: string }; setCookie: string[]; jwt: string | null }>('POST', '/auth/sign-in', { username, password }, false)
  me = async () => (await this.call<{ user: Me }>('GET', '/me')).user
  setUsername = async (username: string) => (await this.call<{ user: Me }>('PUT', '/me/username', { username })).user
  /** Sets the picture (null removes it) and/or the bio; fields left out stay as they are. */
  setProfile = async (patch: { avatar?: string | null; bio?: string; style?: Partial<ProfileStyle>; statsVisibility?: string }) => (await this.call<{ user: Me }>('PUT', '/me/profile', patch)).user
  deleteAccount = () => this.call<void>('DELETE', '/me')

  heartbeat = (game: { gameKey: string; gameName: string; startedAt: number } | null) =>
    // The answer carries the account's official badges (nothing, from a server older than that).
    this.call<{ verified?: boolean; admin?: boolean } | undefined>('PUT', '/presence', game ?? { gameKey: null })
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
  friendStats = (id: string) => this.call<FriendStats>('GET', `/users/${encodeURIComponent(id)}/stats`)
  /** Players whose username starts with `q`. */
  searchPlayers = async (q: string) => (await this.call<{ users: PublicUser[] }>('GET', `/users/search?q=${encodeURIComponent(q)}`)).users
  /** A page of the chat with a friend: the newest, older ones before a message, or only what is newer than one. */
  messages = (id: string, opts: { before?: number; after?: number; limit?: number } = {}) => {
    const q = new URLSearchParams(Object.entries(opts).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([k, v]): [string, string] => [k, String(Math.trunc(v as number))]))
    return this.call<ChatPage>('GET', `/friends/${encodeURIComponent(id)}/messages${q.size ? `?${q}` : ''}`)
  }
  sendMessage = async (id: string, text: string) => (await this.call<{ message: ChatMessage }>('POST', `/friends/${encodeURIComponent(id)}/messages`, { text })).message
  gameFriends = async (key: string) => (await this.call<{ friends: GameFriend[] }>('GET', `/games/${encodeURIComponent(key)}/friends`)).friends

  // Group chats, GIFs (server/src/groups.ts).
  groups = async () => (await this.call<{ groups: GroupChat[] }>('GET', '/groups')).groups
  createGroup = async (name: string, memberIds: string[]) => (await this.call<{ group: GroupChat }>('POST', '/groups', { name, memberIds })).group
  renameGroup = async (id: string, name: string) => (await this.call<{ group: GroupChat }>('PATCH', `/groups/${encodeURIComponent(id)}`, { name })).group
  addToGroup = async (id: string, userId: string) => (await this.call<{ group: GroupChat }>('POST', `/groups/${encodeURIComponent(id)}/members`, { userId })).group
  removeFromGroup = (id: string, userId: string) => this.call<void>('DELETE', `/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`)
  groupMessages = (id: string, opts: { before?: number; after?: number } = {}) => {
    const q = new URLSearchParams(Object.entries(opts).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([k, v]): [string, string] => [k, String(Math.trunc(v as number))]))
    return this.call<GroupPage>('GET', `/groups/${encodeURIComponent(id)}/messages${q.size ? `?${q}` : ''}`)
  }
  sendGroupMessage = async (id: string, text: string) => (await this.call<{ message: GroupMessage }>('POST', `/groups/${encodeURIComponent(id)}/messages`, { text })).message
  searchGifs = async (q: string, page = 1) => (await this.call<{ gifs: GifResult[] }>('GET', `/gifs?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page) })}`)).gifs
  uploadGif = async (base64: string) => (await this.call<{ id: string }>('POST', '/media', { data: base64 })).id
  media = (id: string) => this.call<{ mime: string; data: string }>('GET', `/media/${encodeURIComponent(id)}`)

  // Voice rooms (server/src/voice.ts).
  voiceStart = (opts: { private?: boolean; locked?: boolean }) => this.call<VoiceUpdate>('POST', '/voice/rooms', { private: opts.private === true, locked: opts.locked === true })
  voiceJoin = (roomId: string) => this.call<VoiceUpdate>('POST', `/voice/rooms/${encodeURIComponent(roomId)}/join`)
  voiceLeave = () => this.call<void>('POST', '/voice/leave')
  voiceUpdate = (after: number) => this.call<VoiceUpdate>('GET', `/voice/update?after=${Math.max(0, Math.trunc(after) || 0)}`)
  voiceState = (s: { muted: boolean; deafened: boolean; sharing: boolean; camera: boolean; streams: { screen?: string; camera?: string }; watching?: string | null }) => this.call<void>('POST', '/voice/state', s)
  voiceSignal = (signals: { to: string; data: VoiceSignal }[]) => this.call<void>('POST', '/voice/signal', { signals })
  voiceSetRoom = (patch: { private?: boolean; locked?: boolean }) => this.call<VoiceUpdate>('PATCH', '/voice/room', patch)
  voiceInvite = (userId: string) => this.call<void>('POST', '/voice/invite', { userId })
}
