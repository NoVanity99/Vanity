// A stand-in for the Steam Web API and Steam's OpenID sign-in, with the same answers Steam gives.

export interface FakeAccount {
  steamId: string
  name: string
  vanity?: string
  /** "Game details" privacy: when true, Steam answers owned/recent games with an empty object. */
  private?: boolean
  games?: { appid: number; name: string; playtime_forever: number; playtime_2weeks?: number; rtime_last_played?: number; img_icon_url?: string }[]
  /** appid → achievements (apiname, achieved). A game missing here "has no stats". */
  achievements?: Record<number, { apiname: string; name?: string; achieved: 0 | 1; unlocktime?: number }[]>
}

export const KEY = 'TEST-STEAM-KEY-0123456789ABCDEF'

export function fakeSteam(accounts: FakeAccount[]) {
  const calls: string[] = []
  let down = false
  let rejectKey = false
  /** Answers Steam's OpenID check: only assertions this fake "issued" are valid. */
  const issued = new Set<string>()

  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (down) throw new TypeError('fetch failed')
    const u = new URL(url)
    if (u.hostname === 'steamcommunity.com' && u.pathname === '/openid/login') {
      const body = new URLSearchParams(String(init?.body ?? ''))
      const valid = body.get('openid.mode') === 'check_authentication' && issued.delete(body.get('openid.sig') ?? '')
      return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`)
    }
    if (u.hostname !== 'api.steampowered.com') return new Response('not found', { status: 404 })
    calls.push(u.pathname)
    if (rejectKey || u.searchParams.get('key') !== KEY) return new Response('<html>Forbidden</html>', { status: 403 })
    const account = accounts.find((a) => a.steamId === (u.searchParams.get('steamid') ?? u.searchParams.get('steamids')))

    if (u.pathname === '/ISteamUser/ResolveVanityURL/v1/') {
      const hit = accounts.find((a) => a.vanity?.toLowerCase() === u.searchParams.get('vanityurl')?.toLowerCase())
      return json({ response: hit ? { steamid: hit.steamId, success: 1 } : { success: 42, message: 'No match' } })
    }
    if (u.pathname === '/ISteamUser/GetPlayerSummaries/v2/') {
      return json({
        response: {
          players: account
            ? [{ steamid: account.steamId, personaname: account.name, communityvisibilitystate: 3, profileurl: `https://steamcommunity.com/profiles/${account.steamId}/`, avatarfull: `https://avatars.steamstatic.com/${account.steamId}_full.jpg` }]
            : []
        }
      })
    }
    if (u.pathname === '/IPlayerService/GetOwnedGames/v1/') {
      if (!account || account.private) return json({ response: {} })
      const games = account.games ?? []
      return json({ response: { game_count: games.length, ...(games.length ? { games } : {}) } })
    }
    if (u.pathname === '/IPlayerService/GetRecentlyPlayedGames/v1/') {
      if (!account || account.private) return json({ response: {} })
      const games = (account.games ?? []).filter((g) => (g.playtime_2weeks ?? 0) > 0)
      return json({ response: games.length ? { total_count: games.length, games } : { total_count: 0 } })
    }
    if (u.pathname === '/ISteamUserStats/GetPlayerAchievements/v1/') {
      if (!account || account.private) return json({ playerstats: { error: 'Profile is not public', success: false } }, 403)
      const list = account.achievements?.[Number(u.searchParams.get('appid'))]
      if (!list) return json({ playerstats: { error: 'Requested app has no stats', success: false } }, 400)
      return json({ playerstats: { steamID: account.steamId, gameName: 'Game', achievements: list.map((a) => ({ unlocktime: 0, ...a })), success: true } })
    }
    return new Response('not found', { status: 404 })
  }

  /** What Steam appends to the return address after the user signs in as `steamId`. */
  const signIn = (returnTo: string, steamId: string): string => {
    const sig = `sig-${Math.random().toString(36).slice(2)}`
    issued.add(sig)
    const u = new URL(returnTo)
    const p: Record<string, string> = {
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'id_res',
      'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
      'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`,
      'openid.identity': `https://steamcommunity.com/openid/id/${steamId}`,
      'openid.return_to': returnTo,
      'openid.response_nonce': `${new Date().toISOString()}abc`,
      'openid.assoc_handle': '1234567890',
      'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
      'openid.sig': sig
    }
    for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v)
    return u.toString()
  }

  return { fetchFn, calls, signIn, setDown: (v: boolean) => (down = v), setRejectKey: (v: boolean) => (rejectKey = v), count: (path?: string) => (path ? calls.filter((c) => c.includes(path)).length : calls.length) }
}
