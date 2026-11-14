// The app's Steam service against the real Vanity server code and a stand-in for Steam.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SteamState } from '@shared/types'
import { AccountClient } from '../../account/client'
import { AccountError } from '../../account/errors'
import type { AccountService } from '../../account/service'
import { openDatabase } from '../../db/database'
import { createKv } from '../../db/kv'
import { KV } from '../../sync/progress'
import { SteamService } from '../service'

const SERVER = join(__dirname, '../../../../server')
const serverReady = existsSync(join(SERVER, 'node_modules/@electric-sql/pglite'))

type Backend = { fetchFn: (url: string, init?: RequestInit) => Promise<Response>; setDown(down: boolean): void }
type FakeSteam = { fetchFn: (url: string, init?: RequestInit) => Promise<Response>; signIn(returnTo: string, steamId: string): string; count(path?: string): number }

const GABE = '76561197960287930'
const SHY = '76561198000000001'
let backend: Backend
let fake: FakeSteam
let clock = Date.UTC(2026, 10, 14, 12)

function app(user: string | null = 'alice') {
  const db = openDatabase(':memory:').db
  const kv = createKv(db)
  let signedIn = user
  const states: SteamState[] = []
  const opened: string[] = []
  let progressBumps = 0
  const account = {
    state: () => ({ username: signedIn, signedIn: !!signedIn }),
    load: async () => {},
    guard: async <T,>(fn: (c: AccountClient) => Promise<T>): Promise<T> => {
      if (!signedIn) throw new AccountError('Sign in first.', true)
      return fn(new AccountClient('http://vanity.test', backend.fetchFn, async () => `t:${signedIn}`))
    }
  } as unknown as AccountService
  const steam = new SteamService({
    db,
    account,
    openExternal: async (url) => void opened.push(url),
    onProgress: () => progressBumps++,
    onChange: (s) => states.push(s),
    now: () => clock,
    // Waiting is instant in tests; each wait moves the clock like real time would.
    sleep: async (ms) => void (clock += ms)
  })
  return { steam, states, opened, achievementsForXp: () => kv.get<number>(KV.steamAchievements) ?? 0, progressBumps: () => progressBumps, signIn: (u: string | null) => (signedIn = u) }
}

beforeEach(async () => {
  clock = Date.UTC(2026, 10, 14, 12)
  if (!serverReady) return
  const { fakeSteam, KEY } = (await import(/* @vite-ignore */ join(SERVER, 'test/support/fake-steam.ts'))) as { fakeSteam(a: unknown[]): FakeSteam; KEY: string }
  const { testBackend } = (await import(/* @vite-ignore */ join(SERVER, 'test/support/backend.ts'))) as { testBackend(o: unknown): Promise<Backend> }
  fake = fakeSteam([
    {
      steamId: GABE,
      name: 'Rabscuttle',
      vanity: 'gabelogannewell',
      games: [
        { appid: 620, name: 'Portal 2', playtime_forever: 600, playtime_2weeks: 30 },
        { appid: 440, name: 'Team Fortress 2', playtime_forever: 9000 },
        { appid: 10, name: 'Counter-Strike', playtime_forever: 0 }
      ],
      achievements: { 620: [{ apiname: 'A', achieved: 1 }, { apiname: 'B', achieved: 1 }, { apiname: 'C', achieved: 0 }], 440: [{ apiname: 'T', achieved: 1 }] }
    },
    { steamId: SHY, name: 'Shy', vanity: 'shy_one', private: true }
  ])
  backend = await testBackend({ steamApiKey: KEY, fetchFn: fake.fetchFn, now: () => clock })
  for (const u of ['alice', 'bob']) {
    await backend.fetchFn('http://vanity.test/me/username', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer t:${u}` }, body: JSON.stringify({ username: u }) })
  }
})

describe.skipIf(!serverReady)('linked Steam account', () => {
  it('links from a custom URL name and shows name, avatar, games and achievements', async () => {
    const a = app()
    expect(await a.steam.refresh()).toMatchObject({ available: true, configured: true, link: null })
    const s = await a.steam.link('https://steamcommunity.com/id/gabelogannewell')
    a.steam.stop()
    expect(s).toMatchObject({
      link: { steamId: GABE, name: 'Rabscuttle', avatar: `https://avatars.steamstatic.com/${GABE}_full.jpg`, verified: false },
      gamesPrivate: false,
      ownedGames: 3,
      achievements: { unlocked: 3, total: 4, complete: true },
      error: null
    })
    // The achievement count is what XP is worked out from.
    expect(a.achievementsForXp()).toBe(3)
    expect(a.progressBumps()).toBe(1)
  })

  it('explains a wrong id or name without linking anything', async () => {
    const a = app()
    await expect(a.steam.link('nobody_has_this')).rejects.toThrow(/no profile with the custom URL/)
    await expect(a.steam.link('12345')).rejects.toThrow(/17 digits/)
    await expect(a.steam.link('')).rejects.toThrow(/Enter your SteamID/)
    expect(a.steam.state().link).toBeNull()
  })

  it('shows how to fix a private profile, and gives no achievement XP for it', async () => {
    const a = app()
    const s = await a.steam.link('shy_one')
    a.steam.stop()
    expect(s).toMatchObject({ link: { steamId: SHY, name: 'Shy' }, gamesPrivate: true, ownedGames: null, achievements: null })
    expect(s.privateMessage).toMatch(/Game details/)
    expect(a.achievementsForXp()).toBe(0)
  })

  it('unlinks and takes the achievement XP away again', async () => {
    const a = app()
    await a.steam.link(GABE)
    expect(a.achievementsForXp()).toBe(3)
    expect(await a.steam.unlink()).toMatchObject({ link: null, achievements: null, ownedGames: null })
    a.steam.stop()
    expect(a.achievementsForXp()).toBe(0)
    expect((await a.steam.refresh()).link).toBeNull()
    a.steam.stop()
  })

  it('remembers the link for the next start, even offline, and follows the account to another device', async () => {
    const a = app()
    await a.steam.link(GABE)
    a.steam.stop()
    // Another device, same Vanity account: the link is on the account, not the device.
    const phone = app()
    expect(await phone.steam.refresh()).toMatchObject({ link: { steamId: GABE }, achievements: { unlocked: 3 } })
    phone.steam.stop()
    expect(phone.achievementsForXp()).toBe(3)

    backend.setDown(true)
    expect(await phone.steam.refresh()).toMatchObject({ link: { steamId: GABE, name: 'Rabscuttle' }, achievements: { unlocked: 3 }, error: null })
    phone.steam.stop()
    backend.setDown(false)
    // A different Vanity account has no link.
    expect((await app('bob').steam.refresh()).link).toBeNull()
  })

  it('forgets everything when you sign out of Vanity', async () => {
    const a = app()
    await a.steam.link(GABE)
    a.steam.stop()
    a.signIn(null)
    a.steam.accountChanged()
    expect(a.steam.state()).toMatchObject({ available: false, link: null, achievements: null })
    expect(a.achievementsForXp()).toBe(0)
  })

  it('links by signing in through Steam: opens Steam’s page and picks the link up when you finish', async () => {
    const a = app()
    const started = await a.steam.signIn()
    expect(started.signingIn).toBe(true)
    expect(a.opened).toHaveLength(1)
    const url = new URL(a.opened[0])
    expect(url.origin + url.pathname).toBe('https://steamcommunity.com/openid/login')

    // The user signs in on Steam, whose page sends the browser back to the Vanity server.
    const back = new URL(fake.signIn(url.searchParams.get('openid.return_to')!, GABE))
    const page = await backend.fetchFn(`http://vanity.test${back.pathname}${back.search}`)
    expect(await page.text()).toContain('Steam linked')

    for (let i = 0; i < 20 && a.steam.state().signingIn; i++) await new Promise((r) => setTimeout(r, 10))
    a.steam.stop()
    expect(a.steam.state()).toMatchObject({ signingIn: false, link: { steamId: GABE, verified: true }, achievements: { unlocked: 3 } })
    expect(a.achievementsForXp()).toBe(3)
  })

  it('gives up on a Steam sign-in that is never finished, and can be cancelled', async () => {
    const a = app()
    await a.steam.signIn()
    for (let i = 0; i < 400 && a.steam.state().signingIn; i++) await new Promise((r) => setTimeout(r, 5))
    expect(a.steam.state()).toMatchObject({ signingIn: false, link: null })
    expect(a.steam.state().error).toMatch(/wasn't finished/)

    await a.steam.signIn()
    expect(a.steam.cancelSignIn().signingIn).toBe(false)
    a.steam.stop()
  })

  it('needs a Vanity account', async () => {
    const a = app(null)
    expect(await a.steam.refresh()).toMatchObject({ available: false, link: null })
    await expect(a.steam.link(GABE)).rejects.toThrow(/Sign in/)
  })
})
