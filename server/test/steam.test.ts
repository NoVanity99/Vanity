import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { VerifyToken } from '../src/auth'
import type { Sql } from '../src/db'
import { schemaStatements } from '../src/schema'
import { parseSteamInput, PRIVATE_MESSAGE } from '../src/steam'
import { fakeSteam, KEY, type FakeAccount } from './support/fake-steam'

const verifyToken: VerifyToken = async (token) => (token.startsWith('t:') ? { id: token.slice(2), email: null } : null)

const GABE = '76561197960287930'
const PRIVATE = '76561198000000001'
const EMPTY = '76561198000000002'
const HOUR = 3_600_000

const accounts: FakeAccount[] = [
  {
    steamId: GABE,
    name: 'Rabscuttle',
    vanity: 'gabelogannewell',
    games: [
      { appid: 620, name: 'Portal 2', playtime_forever: 600, playtime_2weeks: 30, rtime_last_played: 1_790_000_000, img_icon_url: 'abc123' },
      { appid: 440, name: 'Team Fortress 2', playtime_forever: 9000, rtime_last_played: 1_700_000_000 },
      { appid: 10, name: 'Counter-Strike', playtime_forever: 0 },
      { appid: 730, name: 'Counter-Strike 2', playtime_forever: 120, rtime_last_played: 1_750_000_000 }
    ],
    achievements: {
      620: [
        { apiname: 'ACH.A', name: 'Wake Up Call', achieved: 1, unlocktime: 1_700_000_100 },
        { apiname: 'ACH.B', name: 'Lunacy', achieved: 1, unlocktime: 1_700_000_200 },
        { apiname: 'ACH.C', name: 'Still Alive', achieved: 0 }
      ],
      440: [{ apiname: 'TF.A', achieved: 1 }]
      // 730 has no stats
    }
  },
  { steamId: PRIVATE, name: 'Shy', vanity: 'shy_one', private: true },
  { steamId: EMPTY, name: 'New Here', games: [] }
]

let app: ReturnType<typeof createApp>
let steam: ReturnType<typeof fakeSteam>
let clock: number

async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', host: 'vanity.test', 'x-forwarded-proto': 'https', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // an HTML page
  }
  return { status: res.status, json, text }
}

async function build(over: Partial<Parameters<typeof createApp>[0]> = {}): Promise<void> {
  const db = new PGlite()
  const sql: Sql = async (strings, ...values) => (await db.query(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values)).rows as never
  app = createApp({
    sql,
    verifyToken,
    migrate: async () => {
      for (const statement of schemaStatements()) await db.query(statement)
    },
    steamApiKey: KEY,
    steamRateLimit: 1000,
    fetchFn: steam.fetchFn,
    now: () => clock,
    ...over
  })
  await call('PUT', '/me/username', 't:a', { username: 'alice' })
  await call('PUT', '/me/username', 't:b', { username: 'bob' })
}

beforeEach(async () => {
  clock = Date.UTC(2026, 10, 14, 12)
  steam = fakeSteam(accounts)
  await build()
})

describe('what counts as a Steam account', () => {
  it('accepts a SteamID64, both kinds of profile link, and a custom URL name', () => {
    expect(parseSteamInput(GABE)).toEqual({ steamId: GABE })
    expect(parseSteamInput(`  https://steamcommunity.com/profiles/${GABE}/  `)).toEqual({ steamId: GABE })
    expect(parseSteamInput(`steamcommunity.com/profiles/${GABE}`)).toEqual({ steamId: GABE })
    expect(parseSteamInput('https://steamcommunity.com/id/gabelogannewell/')).toEqual({ vanity: 'gabelogannewell' })
    expect(parseSteamInput('http://www.steamcommunity.com/id/Some-Name_1?l=english')).toEqual({ vanity: 'Some-Name_1' })
    expect(parseSteamInput('gabelogannewell')).toEqual({ vanity: 'gabelogannewell' })
  })

  it('explains what is wrong with anything else', () => {
    expect(() => parseSteamInput('')).toThrow(/Enter your SteamID/)
    expect(() => parseSteamInput('12345')).toThrow(/17 digits/)
    expect(() => parseSteamInput('https://example.com/id/me')).toThrow(/steamcommunity\.com/)
    expect(() => parseSteamInput('https://steamcommunity.com/profiles/abc')).toThrow(/valid SteamID/)
    expect(() => parseSteamInput('name with spaces')).toThrow(/custom URL name/)
  })
})

describe('linking', () => {
  it('links from any accepted form and shows the Steam name and avatar', async () => {
    expect((await call('GET', '/steam/link', 't:a')).json).toEqual({ configured: true, link: null })
    for (const input of [GABE, `https://steamcommunity.com/profiles/${GABE}`, 'https://steamcommunity.com/id/GabeLoganNewell', 'gabelogannewell']) {
      const r = await call('PUT', '/steam/link', 't:a', { input })
      expect(r.status).toBe(200)
      expect(r.json.link).toMatchObject({ steamId: GABE, name: 'Rabscuttle', avatar: `https://avatars.steamstatic.com/${GABE}_full.jpg`, verified: false })
    }
    expect((await call('GET', '/steam/link', 't:a')).json.link.steamId).toBe(GABE)
    expect((await call('GET', '/steam/link', 't:b')).json.link).toBeNull()
  })

  it('previews an account without linking it', async () => {
    const r = await call('POST', '/steam/resolve', 't:a', { input: 'gabelogannewell' })
    expect(r.json.profile).toMatchObject({ steamId: GABE, name: 'Rabscuttle', profilePublic: true })
    expect((await call('GET', '/steam/link', 't:a')).json.link).toBeNull()
  })

  it('says so when the name or id does not exist', async () => {
    const name = await call('PUT', '/steam/link', 't:a', { input: 'nobody_has_this' })
    expect([name.status, name.json.code]).toEqual([404, 'steam_not_found'])
    expect(name.json.error).toMatch(/no profile with the custom URL "nobody_has_this"/)
    const id = await call('PUT', '/steam/link', 't:a', { input: '76561199999999999' })
    expect([id.status, id.json.code]).toEqual([404, 'steam_not_found'])
    expect((await call('PUT', '/steam/link', 't:a', { input: '123' })).status).toBe(400)
  })

  it('unlinks, and forgets what it knew about that account', async () => {
    await call('PUT', '/steam/link', 't:a', { input: GABE })
    await call('GET', '/steam/achievements-summary', 't:a')
    expect((await call('DELETE', '/steam/link', 't:a')).status).toBe(204)
    expect((await call('GET', '/steam/link', 't:a')).json.link).toBeNull()
    const games = await call('GET', '/steam/owned-games', 't:a')
    expect([games.status, games.json.code]).toEqual([409, 'steam_not_linked'])
  })
})

describe('games and achievements', () => {
  beforeEach(async () => {
    await call('PUT', '/steam/link', 't:a', { input: GABE })
  })

  it('lists owned games with playtime, last played and icon', async () => {
    const r = await call('GET', '/steam/owned-games', 't:a')
    expect(r.json.games).toHaveLength(4)
    expect(r.json.games[0]).toEqual({
      appId: 620,
      name: 'Portal 2',
      playtimeMinutes: 600,
      playtimeTwoWeeksMinutes: 30,
      lastPlayedAt: 1_790_000_000_000,
      iconUrl: 'https://media.steampowered.com/steamcommunity/public/images/apps/620/abc123.jpg'
    })
    expect(r.json.games.find((g: any) => g.appId === 10)).toMatchObject({ playtimeMinutes: 0, lastPlayedAt: null, iconUrl: null })
  })

  it('lists recently played games', async () => {
    expect((await call('GET', '/steam/recent-games', 't:a')).json.games.map((g: any) => g.name)).toEqual(['Portal 2'])
  })

  it("lists a game's achievements, and copes with games that have none", async () => {
    const r = await call('GET', '/steam/achievements/620', 't:a')
    expect(r.json.achievements).toEqual([
      { id: 'ACH.A', name: 'Wake Up Call', description: null, achieved: true, unlockedAt: 1_700_000_100_000 },
      { id: 'ACH.B', name: 'Lunacy', description: null, achieved: true, unlockedAt: 1_700_000_200_000 },
      { id: 'ACH.C', name: 'Still Alive', description: null, achieved: false, unlockedAt: null }
    ])
    expect((await call('GET', '/steam/achievements/730', 't:a')).json.achievements).toEqual([])
    expect((await call('GET', '/steam/achievements/abc', 't:a')).status).toBe(400)
  })

  it('adds up achievements across played games, a batch at a time', async () => {
    const r = await call('GET', '/steam/achievements-summary', 't:a')
    // Three played games (Counter-Strike has 0 minutes and is skipped): 2 + 1 + 0 unlocked of 3 + 1 + 0.
    expect(r.json).toEqual({ unlocked: 3, total: 4, gamesChecked: 3, gamesTotal: 3, complete: true })
    expect(steam.count('GetPlayerAchievements')).toBe(3)
  })

  it('works through a big library over several requests', async () => {
    const big: FakeAccount = {
      steamId: '76561198000000009',
      name: 'Collector',
      games: Array.from({ length: 60 }, (_, i) => ({ appid: 1000 + i, name: `Game ${i}`, playtime_forever: 10, rtime_last_played: 1_700_000_000 + i })),
      achievements: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [1000 + i, [{ apiname: 'A', achieved: 1 as const }]]))
    }
    steam = fakeSteam([big])
    await build()
    await call('PUT', '/steam/link', 't:a', { input: big.steamId })
    const first = (await call('GET', '/steam/achievements-summary', 't:a')).json
    expect(first).toMatchObject({ unlocked: 25, gamesChecked: 25, gamesTotal: 60, complete: false })
    const second = (await call('GET', '/steam/achievements-summary', 't:a')).json
    expect(second).toMatchObject({ unlocked: 50, complete: false })
    const third = (await call('GET', '/steam/achievements-summary', 't:a')).json
    expect(third).toMatchObject({ unlocked: 60, gamesChecked: 60, complete: true })
    // Once everything is known, asking again costs Steam nothing.
    const before = steam.count()
    await call('GET', '/steam/achievements-summary', 't:a')
    expect(steam.count()).toBe(before)
  })

  it('re-checks recently played games hourly and the rest weekly', async () => {
    await call('GET', '/steam/achievements-summary', 't:a')
    const after = (): number => steam.count('GetPlayerAchievements')
    expect(after()).toBe(3)
    clock += 2 * HOUR
    await call('GET', '/steam/achievements-summary', 't:a')
    expect(after()).toBe(4) // only Portal 2 (played in the last two weeks)
    clock += 8 * 24 * HOUR
    await call('GET', '/steam/achievements-summary', 't:a')
    expect(after()).toBe(7)
  })
})

describe('private profiles', () => {
  it('links the account (the name is public) but explains how to share game details', async () => {
    const linked = await call('PUT', '/steam/link', 't:a', { input: 'shy_one' })
    expect(linked.json.link).toMatchObject({ steamId: PRIVATE, name: 'Shy' })
    for (const path of ['/steam/owned-games', '/steam/recent-games', '/steam/achievements/620', '/steam/achievements-summary']) {
      const r = await call('GET', path, 't:a')
      expect([path, r.status, r.json.code]).toEqual([path, 409, 'steam_private'])
      expect(r.json.error).toBe(PRIVATE_MESSAGE)
    }
    expect(PRIVATE_MESSAGE).toMatch(/Privacy Settings/)
    expect(PRIVATE_MESSAGE).toMatch(/Game details/)
  })

  it('tells an empty library apart from a private one', async () => {
    await call('PUT', '/steam/link', 't:a', { input: EMPTY })
    expect((await call('GET', '/steam/owned-games', 't:a')).json).toEqual({ games: [] })
    expect((await call('GET', '/steam/recent-games', 't:a')).json).toEqual({ games: [] })
    expect((await call('GET', '/steam/achievements-summary', 't:a')).json).toMatchObject({ unlocked: 0, gamesTotal: 0, complete: true })
  })
})

describe('protecting the key', () => {
  it('never sends the key, or anything containing it, to the app', async () => {
    const seen: string[] = []
    for (const [method, path, body] of [
      ['PUT', '/steam/link', { input: 'gabelogannewell' }],
      ['GET', '/steam/link'],
      ['GET', '/steam/owned-games'],
      ['GET', '/steam/recent-games'],
      ['GET', '/steam/achievements/620'],
      ['GET', '/steam/achievements-summary'],
      ['PUT', '/steam/link', { input: 'nobody_has_this' }],
      ['POST', '/steam/openid/start']
    ] as const) {
      seen.push((await call(method, path, 't:a', body)).text)
    }
    steam.setRejectKey(true)
    clock += 24 * HOUR
    const rejected = await call('GET', '/steam/owned-games', 't:a')
    expect([rejected.status, rejected.json.code]).toEqual([503, 'steam_key_rejected'])
    seen.push(rejected.text)
    steam.setRejectKey(false)
    steam.setDown(true)
    clock += 24 * HOUR
    const down = await call('GET', '/steam/owned-games', 't:a')
    expect([down.status, down.json.code]).toEqual([502, 'steam_unreachable'])
    seen.push(down.text)
    expect(seen.join('\n')).not.toContain(KEY)
  })

  it('needs a sign-in for every route', async () => {
    for (const [method, path] of [['GET', '/steam/link'], ['PUT', '/steam/link'], ['DELETE', '/steam/link'], ['POST', '/steam/resolve'], ['GET', '/steam/owned-games'], ['GET', '/steam/recent-games'], ['GET', '/steam/achievements/620'], ['GET', '/steam/achievements-summary'], ['POST', '/steam/openid/start']] as const) {
      expect([path, (await call(method, path)).status]).toEqual([path, 401])
    }
    expect(steam.count()).toBe(0)
  })

  it('caches answers for a few minutes, so repeats cost Steam nothing', async () => {
    await call('PUT', '/steam/link', 't:a', { input: 'gabelogannewell' })
    await call('GET', '/steam/owned-games', 't:a')
    await call('GET', '/steam/achievements/620', 't:a')
    const before = steam.count()
    for (let i = 0; i < 5; i++) {
      await call('GET', '/steam/owned-games', 't:a')
      await call('GET', '/steam/achievements/620', 't:a')
      await call('PUT', '/steam/link', 't:a', { input: 'gabelogannewell' })
    }
    // Another account linking the same Steam profile shares the cached answers too.
    await call('PUT', '/steam/link', 't:b', { input: GABE })
    await call('GET', '/steam/owned-games', 't:b')
    expect(steam.count()).toBe(before)

    clock += 11 * 60_000
    await call('GET', '/steam/owned-games', 't:a')
    expect(steam.count('GetOwnedGames')).toBe(2)
  })

  it('limits how fast one account can ask', async () => {
    await build({ steamRateLimit: 5 })
    for (let i = 0; i < 5; i++) expect((await call('PUT', '/steam/link', 't:a', { input: GABE })).status).toBe(200)
    const limited = await call('PUT', '/steam/link', 't:a', { input: GABE })
    expect([limited.status, limited.json.code]).toEqual([429, 'rate_limited'])
    expect((await call('PUT', '/steam/link', 't:b', { input: GABE })).status).toBe(200) // others are unaffected
  })

  it('gives each account a daily budget of calls to Steam, which resets the next day', async () => {
    const big: FakeAccount = {
      steamId: '76561198000000009',
      name: 'Collector',
      games: Array.from({ length: 40 }, (_, i) => ({ appid: 1000 + i, name: `Game ${i}`, playtime_forever: 10 })),
      achievements: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [1000 + i, [{ apiname: 'A', achieved: 1 as const }]]))
    }
    steam = fakeSteam([big, accounts[0]])
    await build({ steamDailyBudget: 12 })
    await call('PUT', '/steam/link', 't:a', { input: big.steamId }) // 1 call
    const partial = (await call('GET', '/steam/achievements-summary', 't:a')).json // 1 (owned) + up to 10 more
    expect(partial.complete).toBe(false)
    expect(partial.gamesChecked).toBeGreaterThan(0)
    expect(steam.count()).toBeLessThanOrEqual(13)
    const blocked = await call('PUT', '/steam/link', 't:a', { input: 'gabelogannewell' })
    expect([blocked.status, blocked.json.code]).toEqual([429, 'steam_budget'])
    // Someone else still has their own budget.
    expect((await call('PUT', '/steam/link', 't:b', { input: GABE })).status).toBe(200)

    clock += 24 * HOUR
    expect((await call('PUT', '/steam/link', 't:a', { input: 'gabelogannewell' })).status).toBe(200)
  })

  it('says Steam is not set up when the server has no key, without calling Steam', async () => {
    await build({ steamApiKey: '' })
    expect((await call('GET', '/steam/link', 't:a')).json).toEqual({ configured: false, link: null })
    const r = await call('PUT', '/steam/link', 't:a', { input: GABE })
    expect([r.status, r.json.code]).toEqual([503, 'steam_not_configured'])
    expect(steam.count()).toBe(0)
  })
})

describe('sign in through Steam', () => {
  const start = async (token = 't:a'): Promise<string> => {
    const r = await call('POST', '/steam/openid/start', token)
    expect(r.status).toBe(200)
    return r.json.url
  }
  const follow = async (url: string): Promise<{ status: number; text: string }> => {
    const u = new URL(url)
    return call('GET', u.pathname + u.search)
  }

  it('sends the browser to Steam and links the account Steam vouches for', async () => {
    const url = new URL(await start())
    expect(url.origin + url.pathname).toBe('https://steamcommunity.com/openid/login')
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup')
    expect(url.searchParams.get('openid.realm')).toBe('https://vanity.test')
    const returnTo = url.searchParams.get('openid.return_to')!
    expect(returnTo).toMatch(/^https:\/\/vanity\.test\/steam\/openid\/return\?state=[0-9a-f]{48}$/)

    const page = await follow(steam.signIn(returnTo, GABE))
    expect(page.status).toBe(200)
    expect(page.text).toContain('Steam linked')
    expect(page.text).toContain('Rabscuttle')
    expect((await call('GET', '/steam/link', 't:a')).json.link).toMatchObject({ steamId: GABE, verified: true })
    // Typing the same id later doesn't lose the "verified" mark; a different id does.
    expect((await call('PUT', '/steam/link', 't:a', { input: GABE })).json.link.verified).toBe(true)
    expect((await call('PUT', '/steam/link', 't:a', { input: EMPTY })).json.link.verified).toBe(false)
  })

  it('refuses a forged answer, a reused link, a cancelled sign-in and an unknown state', async () => {
    const returnTo = new URL(await start()).searchParams.get('openid.return_to')!
    // Forged: right shape, but Steam never issued it.
    const forged = new URL(steam.signIn(returnTo, GABE))
    forged.searchParams.set('openid.sig', 'made-up')
    const bad = await follow(forged.toString())
    expect(bad.status).toBe(400)
    expect(bad.text).toContain("wasn't linked")
    expect((await call('GET', '/steam/link', 't:a')).json.link).toBeNull()
    // The state was used up by that attempt: a genuine answer for it is now too late.
    expect((await follow(steam.signIn(returnTo, GABE))).text).toContain('expired')

    const second = new URL(await start()).searchParams.get('openid.return_to')!
    const cancelled = new URL(second)
    cancelled.searchParams.set('openid.mode', 'cancel')
    expect((await follow(cancelled.toString())).text).toContain('cancelled')

    expect((await follow('https://vanity.test/steam/openid/return?state=nope&openid.mode=id_res')).status).toBe(400)
    expect((await call('GET', '/steam/link', 't:a')).json.link).toBeNull()
  })

  it('cannot be pointed at someone else’s id, and expires', async () => {
    const returnTo = new URL(await start()).searchParams.get('openid.return_to')!
    // A genuine sign-in as one account, edited to claim another: Steam's check covers the claimed id,
    // which the fake models by issuing the signature for one use only.
    const tampered = new URL(steam.signIn(returnTo, GABE))
    tampered.searchParams.set('openid.claimed_id', 'https://evil.example/openid/id/76561198000000002')
    expect((await follow(tampered.toString())).status).toBe(400)

    const later = new URL(await start()).searchParams.get('openid.return_to')!
    clock += 11 * 60_000
    expect((await follow(steam.signIn(later, GABE))).text).toContain('expired')
  })

  it('escapes the Steam name on the result page', async () => {
    steam = fakeSteam([{ steamId: GABE, name: '<script>alert(1)</script>' }])
    await build()
    const returnTo = new URL(await start()).searchParams.get('openid.return_to')!
    const page = await follow(steam.signIn(returnTo, GABE))
    expect(page.text).not.toContain('<script>')
    expect(page.text).toContain('&#60;script&#62;')
  })
})
