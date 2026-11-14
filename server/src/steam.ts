// Everything that talks to the Steam Web API. The key never leaves this server: the app calls
// these routes with the user's sign-in token, the server adds the key, calls Steam and answers.
//
// To protect the key's daily allowance (100,000 calls a day for the whole app):
// - answers are cached in the database for a few minutes;
// - each account has a per-minute request limit and a daily budget of calls to Steam.

import type { Sql } from './db'

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export class SteamError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 429 | 502 | 503 = 400,
    readonly code?: string
  ) {
    super(message)
  }
}

export const PRIVATE_MESSAGE =
  "Steam isn't sharing this account's games. In Steam, open your profile → Edit Profile → Privacy Settings, set \"My profile\" to Public and \"Game details\" to Public, then try again. (Changes can take a few minutes.)"

export interface SteamLink {
  steamId: string
  name: string
  avatar: string | null
  profileUrl: string
  /** Linked by signing in through Steam (proof that the account is yours), not just by typing an id. */
  verified: boolean
  linkedAt: number
}

export interface SteamGame {
  appId: number
  name: string
  playtimeMinutes: number
  playtimeTwoWeeksMinutes: number
  /** When it was last played (ms), if Steam says. */
  lastPlayedAt: number | null
  iconUrl: string | null
}

export interface SteamAchievement {
  id: string
  name: string
  description: string | null
  achieved: boolean
  unlockedAt: number | null
}

const API = 'https://api.steampowered.com'
const STEAM_ID = /^7656119\d{10}$/
const VANITY = /^[A-Za-z0-9_-]{2,32}$/

const TTL = { summary: 5 * 60, owned: 10 * 60, recent: 5 * 60, achievements: 10 * 60, vanity: 24 * 3600 }

/** What the user typed, worked out: a SteamID64, or a custom URL name that still has to be looked up. */
export function parseSteamInput(input: string): { steamId: string } | { vanity: string } {
  const text = input.trim()
  if (!text) throw new SteamError('Enter your SteamID, your Steam profile link, or your custom URL name.')
  if (/^\d+$/.test(text)) {
    if (STEAM_ID.test(text)) return { steamId: text }
    throw new SteamError("That number isn't a SteamID64. It is 17 digits long and starts with 7656119.")
  }
  const url = /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)/i.exec(text)
  if (url) {
    const [, kind, value] = url
    if (kind.toLowerCase() === 'profiles') {
      if (STEAM_ID.test(value)) return { steamId: value }
      throw new SteamError("That profile link doesn't contain a valid SteamID.")
    }
    if (VANITY.test(value)) return { vanity: value }
    throw new SteamError("That profile link doesn't look right.")
  }
  if (/steamcommunity\.com|^https?:\/\//i.test(text)) throw new SteamError('Use a link like steamcommunity.com/profiles/7656119… or steamcommunity.com/id/yourname.')
  if (VANITY.test(text)) return { vanity: text }
  throw new SteamError('Enter a 17-digit SteamID, a Steam profile link, or your custom URL name (letters, numbers, _ and -).')
}

export interface SteamOptions {
  sql: Sql
  /** The Steam Web API key (a server secret). Empty: every Steam route answers "not set up". */
  apiKey: string
  fetchFn?: FetchFn
  now?: () => number
  /** Calls to Steam one account may cause per day. */
  dailyBudget?: number
}

export function createSteam({ sql, apiKey, fetchFn = fetch, now = Date.now, dailyBudget = 1500 }: SteamOptions) {
  const key = apiKey.trim()

  /** Counts calls to Steam against the account's daily budget, refusing when it is used up. */
  async function spend(userId: string, calls: number): Promise<void> {
    const day = new Date(now()).toISOString().slice(0, 10)
    const [row] = await sql<{ calls: number }>`INSERT INTO vanity.api_usage (user_id, day, calls) VALUES (${userId}, ${day}, ${calls})
      ON CONFLICT (user_id, day) DO UPDATE SET calls = vanity.api_usage.calls + ${calls} RETURNING calls`
    if (row.calls > dailyBudget) throw new SteamError("You've reached today's limit for Steam look-ups. It resets at midnight (UTC).", 429, 'steam_budget')
  }

  async function cached<T>(cacheKey: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const [hit] = await sql<{ body: unknown }>`SELECT body FROM vanity.api_cache WHERE cache_key = ${cacheKey} AND expires_at > to_timestamp(${now() / 1000})`
    // Stored wrapped in an object, so a cached text value (a SteamID) can't be mistaken for raw JSON.
    if (hit) return ((typeof hit.body === 'string' ? JSON.parse(hit.body) : hit.body) as { v: T }).v
    const value = await load()
    await sql`INSERT INTO vanity.api_cache (cache_key, body, expires_at) VALUES (${cacheKey}, ${JSON.stringify({ v: value })}::jsonb, to_timestamp(${now() / 1000 + ttlSeconds}))
      ON CONFLICT (cache_key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at`
    return value
  }

  /** One call to the Steam Web API. The key is added here and never appears in errors or logs. */
  async function call(userId: string, path: string, params: Record<string, string | number>): Promise<{ status: number; json: any }> {
    if (!key) throw new SteamError("Steam isn't set up on Vanity's server yet.", 503, 'steam_not_configured')
    await spend(userId, 1)
    const query = new URLSearchParams({ key, format: 'json', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })
    let res: Response
    try {
      res = await fetchFn(`${API}${path}?${query}`, { signal: AbortSignal.timeout(15_000) })
    } catch {
      throw new SteamError("Couldn't reach Steam. Try again in a moment.", 502, 'steam_unreachable')
    }
    if (res.status === 429) throw new SteamError('Steam is busy right now. Try again in a few minutes.', 502, 'steam_busy')
    if (res.status === 401 || (res.status === 403 && !path.includes('GetPlayerAchievements'))) {
      console.error('[steam] Steam rejected the Web API key (HTTP %d). Check the STEAM_WEB_API_KEY secret.', res.status)
      throw new SteamError("Vanity's server couldn't sign in to Steam. Tell whoever runs it that the Steam key needs checking.", 503, 'steam_key_rejected')
    }
    if (res.status >= 500) throw new SteamError('Steam is having trouble right now. Try again in a moment.', 502, 'steam_down')
    let json: any = null
    try {
      json = await res.json()
    } catch {
      // Not JSON: leave null.
    }
    return { status: res.status, json }
  }

  async function resolve(userId: string, input: string): Promise<string> {
    const parsed = parseSteamInput(input)
    if ('steamId' in parsed) return parsed.steamId
    const name = parsed.vanity.toLowerCase()
    const id = await cached<string | null>(`steam:vanity:${name}`, TTL.vanity, async () => {
      const { json } = await call(userId, '/ISteamUser/ResolveVanityURL/v1/', { vanityurl: name })
      const r = json?.response
      return r?.success === 1 && typeof r.steamid === 'string' && STEAM_ID.test(r.steamid) ? r.steamid : null
    })
    if (!id) throw new SteamError(`Steam has no profile with the custom URL "${parsed.vanity}". Check the spelling, or paste your full profile link.`, 404, 'steam_not_found')
    return id
  }

  async function summary(userId: string, steamId: string): Promise<{ steamId: string; name: string; avatar: string | null; profileUrl: string; profilePublic: boolean }> {
    const found = await cached(`steam:summary:${steamId}`, TTL.summary, async () => {
      const { json } = await call(userId, '/ISteamUser/GetPlayerSummaries/v2/', { steamids: steamId })
      const p = json?.response?.players?.[0]
      if (!p) return null
      return {
        steamId,
        name: String(p.personaname ?? 'Steam user').slice(0, 100),
        avatar: typeof p.avatarfull === 'string' ? p.avatarfull : typeof p.avatarmedium === 'string' ? p.avatarmedium : null,
        profileUrl: typeof p.profileurl === 'string' ? p.profileurl : `https://steamcommunity.com/profiles/${steamId}`,
        profilePublic: p.communityvisibilitystate === 3
      }
    })
    if (!found) throw new SteamError("Steam doesn't know that account. Check the SteamID or profile link.", 404, 'steam_not_found')
    return found
  }

  const toGame = (g: any): SteamGame => ({
    appId: Number(g.appid),
    name: String(g.name ?? `App ${g.appid}`),
    playtimeMinutes: Number(g.playtime_forever) || 0,
    playtimeTwoWeeksMinutes: Number(g.playtime_2weeks) || 0,
    lastPlayedAt: Number(g.rtime_last_played) > 0 ? Number(g.rtime_last_played) * 1000 : null,
    iconUrl: g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : null
  })

  /** Every game the account owns. Throws the "private" error when Steam isn't sharing them. */
  async function ownedGames(userId: string, steamId: string): Promise<SteamGame[]> {
    const games = await cached<SteamGame[] | null>(`steam:owned:${steamId}`, TTL.owned, async () => {
      const { json } = await call(userId, '/IPlayerService/GetOwnedGames/v1/', { steamid: steamId, include_appinfo: 1, include_played_free_games: 1 })
      const r = json?.response
      // A private account answers with an empty object, not an error.
      if (!r || !Array.isArray(r.games)) return r && r.game_count === 0 ? [] : null
      return r.games.filter((g: any) => Number.isInteger(g?.appid)).map(toGame)
    })
    if (!games) throw new SteamError(PRIVATE_MESSAGE, 409, 'steam_private')
    return games
  }

  async function recentGames(userId: string, steamId: string): Promise<SteamGame[]> {
    const games = await cached<SteamGame[] | null>(`steam:recent:${steamId}`, TTL.recent, async () => {
      const { json } = await call(userId, '/IPlayerService/GetRecentlyPlayedGames/v1/', { steamid: steamId, count: 20 })
      const r = json?.response
      if (!r) return null
      if (!Array.isArray(r.games)) return r.total_count === 0 ? [] : null
      return r.games.filter((g: any) => Number.isInteger(g?.appid)).map(toGame)
    })
    if (games) return games
    // An empty answer means "nothing in two weeks" or "private": the owned-games call tells which.
    await ownedGames(userId, steamId)
    return []
  }

  /** A game's achievements for the account. `null` list: the game has none. */
  async function achievements(userId: string, steamId: string, appId: number): Promise<{ appId: number; gameName: string | null; achievements: SteamAchievement[] }> {
    const result = await cached<{ appId: number; gameName: string | null; achievements: SteamAchievement[] } | 'private'>(`steam:ach:${steamId}:${appId}`, TTL.achievements, async () => {
      const { status, json } = await call(userId, '/ISteamUserStats/GetPlayerAchievements/v1/', { steamid: steamId, appid: appId, l: 'english' })
      const stats = json?.playerstats
      if (status === 403 || /not public/i.test(String(stats?.error ?? ''))) return 'private'
      // Games without achievements answer with an error ("Requested app has no stats").
      if (!stats?.success || !Array.isArray(stats.achievements)) return { appId, gameName: stats?.gameName ?? null, achievements: [] }
      return {
        appId,
        gameName: stats.gameName ?? null,
        achievements: stats.achievements.map((a: any) => ({
          id: String(a.apiname),
          name: String(a.name ?? a.apiname),
          description: a.description ? String(a.description) : null,
          achieved: a.achieved === 1,
          unlockedAt: a.achieved === 1 && Number(a.unlocktime) > 0 ? Number(a.unlocktime) * 1000 : null
        }))
      }
    })
    if (result === 'private') throw new SteamError(PRIVATE_MESSAGE, 409, 'steam_private')
    return result
  }

  /**
   * How many achievements the account has unlocked in all. Steam has no single call for this:
   * each game is its own call, so games are checked a batch at a time and remembered. Games
   * played recently are re-checked hourly, the rest weekly. `complete` is false while games are
   * still waiting for their first check (ask again in a little while).
   */
  async function achievementSummary(userId: string, steamId: string, batch = 25): Promise<{ unlocked: number; total: number; gamesChecked: number; gamesTotal: number; complete: boolean }> {
    const played = (await ownedGames(userId, steamId)).filter((g) => g.playtimeMinutes > 0)
    const rows = await sql<{ app_id: number; unlocked: number; total: number; checked_at: unknown }>`
      SELECT app_id, unlocked, total, checked_at FROM vanity.steam_achievements WHERE user_id = ${userId} AND steam_id = ${steamId}`
    const known = new Map(rows.map((r) => [r.app_id, { unlocked: r.unlocked, total: r.total, at: r.checked_at instanceof Date ? r.checked_at.getTime() : Date.parse(String(r.checked_at)) }]))
    const t = now()
    const due = played
      .filter((g) => {
        const k = known.get(g.appId)
        if (!k) return true
        const age = t - k.at
        return g.playtimeTwoWeeksMinutes > 0 ? age > 3_600_000 : age > 7 * 86_400_000
      })
      // Never-checked games first, then the most recently played.
      .sort((a, b) => Number(known.has(a.appId)) - Number(known.has(b.appId)) || (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
      .slice(0, batch)

    let stop = false
    for (let i = 0; i < due.length && !stop; i += 5) {
      const results = await Promise.all(
        due.slice(i, i + 5).map(async (g) => {
          try {
            const a = await achievements(userId, steamId, g.appId)
            return { appId: g.appId, unlocked: a.achievements.filter((x) => x.achieved).length, total: a.achievements.length }
          } catch (err) {
            return err instanceof SteamError ? err : null
          }
        })
      )
      for (const r of results) {
        if (!r) continue
        if (r instanceof SteamError) {
          // Private, or the key is missing or rejected: the whole request fails with that message.
          if (r.code === 'steam_private' || r.status === 503) throw r
          // Out of budget for today: keep what we have and stop. Anything else: skip this game for now.
          if (r.code === 'steam_budget') stop = true
          continue
        }
        known.set(r.appId, { unlocked: r.unlocked, total: r.total, at: t })
        await sql`INSERT INTO vanity.steam_achievements (user_id, steam_id, app_id, unlocked, total, checked_at)
          VALUES (${userId}, ${steamId}, ${r.appId}, ${r.unlocked}, ${r.total}, to_timestamp(${t / 1000}))
          ON CONFLICT (user_id, steam_id, app_id) DO UPDATE SET unlocked = excluded.unlocked, total = excluded.total, checked_at = excluded.checked_at`
      }
    }

    const ownedIds = new Set(played.map((g) => g.appId))
    let unlocked = 0
    let total = 0
    let checked = 0
    for (const [appId, k] of known) {
      if (!ownedIds.has(appId)) continue
      unlocked += k.unlocked
      total += k.total
      checked++
    }
    return { unlocked, total, gamesChecked: checked, gamesTotal: played.length, complete: checked >= played.length }
  }

  // ---- linking ---------------------------------------------------------------------

  const toLink = (r: { external_id: string; display_name: string; avatar_url: string | null; profile_url: string; verified: boolean; linked_at: unknown }): SteamLink => ({
    steamId: r.external_id,
    name: r.display_name,
    avatar: r.avatar_url,
    profileUrl: r.profile_url,
    verified: r.verified,
    linkedAt: r.linked_at instanceof Date ? r.linked_at.getTime() : Date.parse(String(r.linked_at))
  })

  async function getLink(userId: string): Promise<SteamLink | null> {
    const [row] = await sql<Parameters<typeof toLink>[0]>`SELECT external_id, display_name, avatar_url, profile_url, verified, linked_at
      FROM vanity.linked_accounts WHERE user_id = ${userId} AND provider = 'steam'`
    return row ? toLink(row) : null
  }

  async function saveLink(userId: string, steamId: string, verified: boolean): Promise<SteamLink> {
    const s = await summary(userId, steamId)
    const [row] = await sql<Parameters<typeof toLink>[0]>`INSERT INTO vanity.linked_accounts (user_id, provider, external_id, display_name, avatar_url, profile_url, verified, linked_at)
      VALUES (${userId}, 'steam', ${steamId}, ${s.name}, ${s.avatar}, ${s.profileUrl}, ${verified}, now())
      ON CONFLICT (user_id, provider) DO UPDATE SET external_id = excluded.external_id, display_name = excluded.display_name,
        avatar_url = excluded.avatar_url, profile_url = excluded.profile_url,
        verified = excluded.verified OR (vanity.linked_accounts.verified AND vanity.linked_accounts.external_id = excluded.external_id),
        linked_at = CASE WHEN vanity.linked_accounts.external_id = excluded.external_id THEN vanity.linked_accounts.linked_at ELSE now() END
      RETURNING external_id, display_name, avatar_url, profile_url, verified, linked_at`
    return toLink(row)
  }

  async function link(userId: string, input: string): Promise<SteamLink> {
    return saveLink(userId, await resolve(userId, input), false)
  }

  async function unlink(userId: string): Promise<void> {
    await sql`DELETE FROM vanity.linked_accounts WHERE user_id = ${userId} AND provider = 'steam'`
    await sql`DELETE FROM vanity.steam_achievements WHERE user_id = ${userId}`
  }

  /** The linked account's SteamID, or the "link first" error. */
  async function linkedId(userId: string): Promise<string> {
    const l = await getLink(userId)
    if (!l) throw new SteamError('Link your Steam account first (Account → Linked accounts).', 409, 'steam_not_linked')
    return l.steamId
  }

  // ---- "Sign in through Steam" (OpenID 2.0): proves the account is yours ----------------

  const OPENID = 'https://steamcommunity.com/openid/login'

  async function openIdStart(userId: string, serverOrigin: string): Promise<{ url: string; state: string }> {
    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    const state = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    await sql`DELETE FROM vanity.openid_states WHERE expires_at < now() OR user_id = ${userId}`
    await sql`INSERT INTO vanity.openid_states (state, user_id, expires_at) VALUES (${state}, ${userId}, to_timestamp(${now() / 1000 + 600}))`
    const returnTo = `${serverOrigin}/steam/openid/return?state=${state}`
    const query = new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo,
      'openid.realm': serverOrigin,
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
    })
    return { url: `${OPENID}?${query}`, state }
  }

  /** Steam sent the browser back: check with Steam that the answer is genuine, then link. */
  async function openIdReturn(params: URLSearchParams, serverOrigin: string): Promise<SteamLink> {
    const state = params.get('state') ?? ''
    const [pending] = await sql<{ user_id: string }>`DELETE FROM vanity.openid_states WHERE state = ${state} AND expires_at > to_timestamp(${now() / 1000}) RETURNING user_id`
    if (!pending) throw new SteamError('This sign-in link has expired. Go back to Vanity and try again.', 400, 'openid_expired')
    if (params.get('openid.mode') !== 'id_res') throw new SteamError('Steam sign-in was cancelled.', 400, 'openid_cancelled')
    const claimed = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/.exec(params.get('openid.claimed_id') ?? '')
    const returnTo = params.get('openid.return_to') ?? ''
    if (!claimed || !returnTo.startsWith(`${serverOrigin}/steam/openid/return?state=${state}`)) throw new SteamError("Steam's answer didn't check out. Try again.", 400, 'openid_invalid')

    // Ask Steam itself whether it really sent this answer (it can't be forged by the browser).
    const check = new URLSearchParams()
    for (const [k, v] of params) if (k.startsWith('openid.')) check.set(k, v)
    check.set('openid.mode', 'check_authentication')
    let text = ''
    try {
      const res = await fetchFn(OPENID, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: check.toString(), signal: AbortSignal.timeout(15_000) })
      text = await res.text()
    } catch {
      throw new SteamError("Couldn't reach Steam to confirm the sign-in. Try again.", 502, 'steam_unreachable')
    }
    if (!/^is_valid\s*:\s*true\s*$/m.test(text)) throw new SteamError("Steam didn't confirm the sign-in. Try again.", 400, 'openid_invalid')
    return saveLink(pending.user_id, claimed[1], true)
  }

  return { configured: !!key, resolve, summary, ownedGames, recentGames, achievements, achievementSummary, getLink, link, unlink, linkedId, openIdStart, openIdReturn }
}

export type Steam = ReturnType<typeof createSteam>
