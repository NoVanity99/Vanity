import type { VoiceUser } from '../../../src/shared/voiceProtocol'

/** Checks who a sign-in token belongs to. Null: not a valid sign-in. Throws when it couldn't be checked at all. */
export type VerifyToken = (token: string) => Promise<VoiceUser | null>

export class AuthUnavailableError extends Error {}

/**
 * Asks the Vanity server who a token belongs to (its /me route), so a voice room shows each
 * player's real Vanity name, picture, look and badges, and nobody can join as somebody else.
 * Answers are remembered for a few minutes so reconnecting doesn't ask again.
 */
export function vanityVerifier(apiUrl: string, fetchFn: typeof fetch = fetch, cacheMs = 5 * 60_000): VerifyToken {
  const base = apiUrl.replace(/\/+$/, '')
  const cache = new Map<string, { user: VoiceUser | null; at: number }>()
  return async (token) => {
    const hit = cache.get(token)
    if (hit && Date.now() - hit.at < cacheMs) return hit.user
    let res: Response
    try {
      res = await fetchFn(`${base}/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
    } catch {
      throw new AuthUnavailableError("The voice server couldn't reach Vanity's account server.")
    }
    if (res.status === 401 || res.status === 403) {
      cache.set(token, { user: null, at: Date.now() })
      return null
    }
    if (!res.ok) throw new AuthUnavailableError(`Vanity's account server answered HTTP ${res.status}.`)
    const body = (await res.json().catch(() => null)) as { user?: Record<string, unknown> } | null
    const u = body?.user
    // An account must have a username to be seen by others (the same rule as friends).
    if (!u || typeof u.id !== 'string' || typeof u.username !== 'string' || !u.username) {
      cache.set(token, { user: null, at: Date.now() })
      return null
    }
    const user: VoiceUser = {
      id: u.id,
      username: u.username,
      avatar: typeof u.avatar === 'string' && u.avatar.startsWith('data:image/') ? u.avatar : null,
      style: u.style ?? null,
      verified: u.verified === true,
      admin: u.admin === true
    }
    cache.set(token, { user, at: Date.now() })
    // Don't let the cache grow without end on a busy server.
    if (cache.size > 5000) for (const [k, v] of cache) if (Date.now() - v.at > cacheMs) cache.delete(k)
    return user
  }
}
