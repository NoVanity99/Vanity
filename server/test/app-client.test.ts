// End to end: the app's AccountService signing in at a real Better Auth server (the software
// Neon Auth runs, configured the way Neon documents it) and talking to this server with the
// tokens it gets (real routes, real token checks, real SQL on PGlite).
import { VERIFIED_USERNAMES } from '../src/roles'
import { PGlite } from '@electric-sql/pglite'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { emailOTP, jwt } from 'better-auth/plugins'
import { createLocalJWKSet, type JSONWebKeySet } from 'jose'
import { describe, expect, it } from 'vitest'
import { createApp, neonAuthSignIn } from '../src/app'
import { neonAuthVerifier } from '../src/auth'
import type { Sql } from '../src/db'
import { schemaStatements } from '../src/schema'
import { AccountService, type SavedSession } from '../../src/main/account/service'
import { gameKey } from '../../src/main/account/gameKey'
import type { AuthHttp } from '../../src/main/account/neonAuth'

const AUTH_URL = 'https://auth.test/neondb/auth'
const API_URL = 'http://vanity.test'
const ORIGIN = 'http://localhost:5173'

/** A stand-in for Neon Auth: same endpoints, cookies, origin check, EdDSA tokens and emailed codes. */
function neonAuthDouble(opts: { sessionSeconds?: number } = {}) {
  const codes = new Map<string, string>()
  const memory: { user: { id: string; email: string }[]; [table: string]: unknown[] } = { user: [], session: [], account: [], verification: [], jwks: [] }
  const auth = betterAuth({
    baseURL: AUTH_URL,
    basePath: '/neondb/auth',
    secret: 'k3Jx0p9QmW7vT2yB5nR8sL1dF4gH6jZa',
    database: memoryAdapter(memory),
    emailAndPassword: { enabled: true },
    session: opts.sessionSeconds ? { expiresIn: opts.sessionSeconds } : undefined,
    trustedOrigins: ['http://localhost:*'],
    advanced: { cookiePrefix: 'neon-auth', useSecureCookies: true },
    logger: { disabled: true },
    plugins: [jwt({ jwks: { jwksPath: '/.well-known/jwks.json' } }), emailOTP({ sendVerificationOTP: async ({ email, otp }) => void codes.set(email, otp) })]
  })
  let down = false
  const requests: { path: string; origin: string | null; cookie: string | null }[] = []
  const http: AuthHttp = async ({ url, method, headers, body }) => {
    if (down) throw new TypeError('fetch failed')
    requests.push({ path: url.replace(AUTH_URL, ''), origin: headers.origin ?? null, cookie: headers.cookie ?? null })
    const res = await auth.handler(new Request(url, { method, headers, body }))
    const out: Record<string, string> = {}
    res.headers.forEach((value, name) => (out[name.toLowerCase()] = value))
    return { status: res.status, headers: out, setCookie: res.headers.getSetCookie(), body: await res.text() }
  }
  const jwks = async (): Promise<JSONWebKeySet> => (await (await auth.handler(new Request(`${AUTH_URL}/.well-known/jwks.json`))).json()) as JSONWebKeySet
  // What the Vanity server uses for signing in with a username.
  const signIn = neonAuthSignIn(AUTH_URL, ORIGIN, ((url: string, init?: RequestInit) => auth.handler(new Request(url, init))) as typeof fetch)
  const emailOf = async (id: string): Promise<string | null> => memory.user.find((u) => u.id === id)?.email ?? null
  return { http, codes, requests, jwks, signIn, emailOf, setDown: (v: boolean) => (down = v) }
}

async function backend(authDouble: ReturnType<typeof neonAuthDouble>) {
  const db = new PGlite()
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  // The server checks tokens against the auth server's published keys, fetched when first needed.
  let keys: ReturnType<typeof createLocalJWKSet> | null = null
  const verifyToken = neonAuthVerifier(async (header, token) => (keys ??= createLocalJWKSet(await authDouble.jwks()))(header, token))
  const app = createApp({
    sql,
    verifyToken,
    migrate: async () => {
      for (const statement of schemaStatements()) await db.query(statement)
    },
    lookupRateLimit: 1000,
    authSignIn: authDouble.signIn,
    emailOfUser: authDouble.emailOf
  })
  let down = false
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (down) throw new TypeError('fetch failed')
    return app.request(url.replace(API_URL, ''), init)
  }
  return { fetchFn, db, setDown: (v: boolean) => (down = v) }
}

type Game = { id: number; name: string; playtimeSeconds: number; lastPlayedAt: number | null }

/** A Vanity app instance with its own secure storage and a tiny fake library. */
function vanity(env: { http: AuthHttp; fetchFn: (url: string, init?: RequestInit) => Promise<Response> }, games: Game[] = [], vaultBox: { saved: SavedSession | null } = { saved: null }) {
  let running: { id: number; startedAt: number } | null = null
  let clock = 0
  const store = { list: () => games, get: (id: number) => games.find((g) => g.id === id) ?? null }
  const states: ReturnType<AccountService['state']>[] = []
  const service = new AccountService({
    store: store as never,
    fetchFn: env.fetchFn,
    authHttp: env.http,
    backend: () => ({ authUrl: AUTH_URL, apiUrl: API_URL, origin: ORIGIN }),
    vault: { load: async () => vaultBox.saved, save: async (s) => void (vaultBox.saved = s) },
    runningGame: () => running,
    onChange: (s) => states.push(s),
    now: () => Date.now() + clock
  })
  return { service, states, vault: vaultBox, play: (r: typeof running) => (running = r), advance: (ms: number) => (clock += ms) }
}

async function world(opts: { sessionSeconds?: number } = {}) {
  const auth = neonAuthDouble(opts)
  const api = await backend(auth)
  return { auth, api, env: { http: auth.http, fetchFn: api.fetchFn } }
}

describe('app ↔ Neon Auth ↔ server', () => {
  it('signs up two players, makes them friends, and shares presence and stats', async () => {
    const { env } = await world()
    const me = vanity(env, [{ id: 1, name: 'Portal 2', playtimeSeconds: 7200, lastPlayedAt: Date.now() }])
    const friend = vanity(env, [
      { id: 1, name: 'Portal 2', playtimeSeconds: 3600, lastPlayedAt: Date.now() },
      { id: 2, name: 'The Witcher® 3: Wild Hunt', playtimeSeconds: 90000, lastPlayedAt: Date.now() }
    ])

    expect(await me.service.signUp('jordan@example.com', 'jordan', 'correct horse', true)).toMatchObject({
      available: true,
      signedIn: true,
      username: 'jordan',
      email: 'jordan@example.com',
      needsUsername: false,
      remembered: true
    })
    await friend.service.signUp('sam@example.com', 'sam', 'battery staple', true)
    me.service.stop()
    friend.service.stop()

    await me.service.guard((c) => c.addFriend('sam'))
    const req = await friend.service.guard((c) => c.friends())
    await friend.service.guard((c) => c.accept(req.incoming[0].id))

    friend.play({ id: 2, startedAt: Date.now() - 5 * 60_000 })
    await friend.service.heartbeat()
    await friend.service.syncStats()
    await me.service.syncStats()

    const list = await me.service.guard((c) => c.friends())
    expect(list.friends[0]).toMatchObject({
      username: 'sam',
      status: { state: 'playing', gameName: 'The Witcher® 3: Wild Hunt' },
      totalPlaytimeSeconds: 93600,
      topGame: 'The Witcher® 3: Wild Hunt'
    })
    // Same game key regardless of punctuation or store.
    const whoPlayed = await me.service.guard((c) => c.gameFriends(gameKey('The Witcher 3 - Wild Hunt')))
    expect(whoPlayed.map((f) => f.username)).toEqual(['sam'])

    await friend.service.signOut()
    expect((await me.service.guard((c) => c.friends())).friends[0].status.state).toBe('offline')
  })

  it('shows a badge granted on the server within a check-in, with no app update, and takes it away the same way', async () => {
    const { env } = await world()
    const me = vanity(env)
    const friend = vanity(env)
    await me.service.signUp('late@example.com', 'latecomer', 'correct horse', true)
    await friend.service.signUp('pal@example.com', 'pal', 'battery staple', true)
    me.service.stop()
    friend.service.stop()
    await me.service.guard((c) => c.addFriend('pal'))
    const req = await friend.service.guard((c) => c.friends())
    await friend.service.guard((c) => c.accept(req.incoming[0].id))
    expect(me.service.state()).toMatchObject({ verified: false, admin: false })

    // The server's list changes while both apps are running.
    VERIFIED_USERNAMES.push('LateComer')
    try {
      await me.service.heartbeat() // the app's once-a-minute check-in
      expect(me.service.state()).toMatchObject({ verified: true, admin: false })
      expect(me.states.at(-1)).toMatchObject({ verified: true }) // the screens were told
      expect(me.vault.saved).toMatchObject({ verified: true }) // and it is remembered
      // Friends see it the next time their list refreshes (every 30 seconds while it is open).
      expect((await friend.service.guard((c) => c.friends())).friends[0]).toMatchObject({ username: 'latecomer', verified: true })
    } finally {
      VERIFIED_USERNAMES.pop()
    }
    await me.service.heartbeat()
    expect(me.service.state()).toMatchObject({ verified: false })
    expect((await friend.service.guard((c) => c.friends())).friends[0]).toMatchObject({ verified: false })
  })

  it('sends every sign-in request with a trusted origin, and the password only to the auth server', async () => {
    const { auth, api, env } = await world()
    const seen: string[] = []
    const spied = { http: env.http, fetchFn: async (url: string, init?: RequestInit) => (seen.push(String(init?.body ?? '') + JSON.stringify(init?.headers ?? {})), api.fetchFn(url, init)) }
    const app = vanity(spied)
    await app.service.signUp('a@example.com', 'alice', 'pa55word-secret', true)
    app.service.stop()
    expect(auth.requests.length).toBeGreaterThan(0)
    expect(auth.requests.every((r) => r.origin === ORIGIN)).toBe(true)
    // The Vanity server never sees the password or the session cookie: only short-lived tokens.
    expect(seen.join('\n')).not.toContain('pa55word-secret')
    expect(seen.join('\n')).not.toContain('session_token')
    // What is saved for "stay signed in" is the session cookie, not the password.
    expect(JSON.stringify(app.vault.saved)).toContain('session_token')
    expect(JSON.stringify(app.vault.saved)).not.toContain('pa55word-secret')
  })

  it('stays signed in across restarts, unless "stay signed in" was off', async () => {
    const { env } = await world()
    const first = vanity(env)
    await first.service.signUp('a@example.com', 'alice', 'longpassword', true)
    first.service.stop()

    const restarted = vanity(env, [], first.vault)
    await restarted.service.load()
    restarted.service.stop()
    expect(restarted.service.state()).toMatchObject({ signedIn: true, username: 'alice', email: 'a@example.com' })
    expect((await restarted.service.guard((c) => c.me())).username).toBe('alice')

    await restarted.service.signOut()
    expect(restarted.vault.saved).toBeNull()

    const temporary = vanity(env)
    expect(await temporary.service.signIn('a@example.com', 'longpassword', false)).toMatchObject({ signedIn: true, username: 'alice', remembered: false })
    temporary.service.stop()
    expect(temporary.vault.saved).toBeNull()
    const afterClose = vanity(env, [], temporary.vault)
    await afterClose.service.load()
    expect(afterClose.service.state().signedIn).toBe(false)
  })

  it('gets a new token by itself when the old one runs out', async () => {
    const { auth, env } = await world()
    const app = vanity(env)
    await app.service.signUp('a@example.com', 'alice', 'longpassword', true)
    app.service.stop()
    const first = await app.service.token()
    expect(await app.service.token()).toBe(first) // reused while it is valid
    const before = auth.requests.length
    app.advance(16 * 60_000) // tokens last 15 minutes
    await app.service.guard((c) => c.me())
    expect(auth.requests.length).toBeGreaterThan(before)
    expect(app.service.state().signedIn).toBe(true)
  })

  it('signs out here, and says why, when the session has ended on the server', async () => {
    const { env } = await world()
    const phone = vanity(env)
    await phone.service.signUp('a@example.com', 'alice', 'longpassword', true)
    phone.service.stop()

    // The same session, ended from elsewhere (same cookie, as after "sign out everywhere").
    const copy = vanity(env, [], { saved: { ...phone.vault.saved! } })
    await copy.service.load()
    copy.service.stop()
    await copy.service.signOut()

    phone.advance(16 * 60_000)
    await expect(phone.service.guard((c) => c.friends())).rejects.toThrow(/session has expired/)
    expect(phone.service.state()).toMatchObject({ signedIn: false, sessionExpired: true })
    expect(phone.vault.saved).toBeNull()
    // Signing in again clears the notice.
    expect(await phone.service.signIn('a@example.com', 'longpassword', true)).toMatchObject({ signedIn: true, sessionExpired: false, username: 'alice' })
    phone.service.stop()
  })

  it('keeps you signed in while offline, with a message that says so', async () => {
    const { auth, api, env } = await world()
    const app = vanity(env)
    await app.service.signUp('a@example.com', 'alice', 'longpassword', true)
    app.service.stop()

    auth.setDown(true)
    api.setDown(true)
    app.advance(16 * 60_000)
    await expect(app.service.guard((c) => c.friends())).rejects.toThrow(/offline/)
    expect(app.service.state().signedIn).toBe(true)
    await expect(vanity(env).service.signIn('a@example.com', 'longpassword', true)).rejects.toThrow(/offline/)

    auth.setDown(false)
    api.setDown(false)
    expect((await app.service.guard((c) => c.friends())).friends).toEqual([])
  })

  it('explains wrong passwords, taken emails and taken usernames', async () => {
    const { env } = await world()
    const a = vanity(env)
    await a.service.signUp('a@example.com', 'alice', 'longpassword', true)
    a.service.stop()
    const b = vanity(env)
    await expect(b.service.signIn('a@example.com', 'wrong-password')).rejects.toThrow('Incorrect username/email or password.')
    await expect(b.service.signIn('nobody@example.com', 'whatever123')).rejects.toThrow('Incorrect username/email or password.')
    // The same words whatever was wrong, by email or by username.
    await expect(b.service.signIn('alice', 'wrong-password', true)).rejects.toThrow('Incorrect username/email or password.')
    await expect(b.service.signIn('nobody_here', 'longpassword', true)).rejects.toThrow('Incorrect username/email or password.')
    await expect(b.service.signIn('not a name!', 'longpassword', true)).rejects.toThrow('Incorrect username/email or password.')
    await expect(b.service.signIn('', '', true)).rejects.toThrow('Incorrect username/email or password.')
    expect(b.service.state().signedIn).toBe(false)
    await expect(b.service.signUp('b@example.com', 'ALICE', 'longpassword', true)).rejects.toThrow('That username is already in use.')
    await expect(b.service.signUp('a@example.com', 'bob', 'longpassword', true)).rejects.toThrow('That email is already in use. Sign in instead, or use another email.')
    await expect(b.service.signUp('A@Example.com', 'bob', 'longpassword', true)).rejects.toThrow(/email is already in use/)
    // Neither refusal left anything behind: the names are still free for someone else, and nobody got signed in.
    expect(b.service.state().signedIn).toBe(false)
    expect(await b.service.availability({ username: 'bob', email: 'b@example.com' })).toMatchObject({ username: true })
    expect(await b.service.availability({ username: 'Alice' })).toEqual({ username: false, email: null })
    expect(await b.service.availability({ username: 'x', email: 'nope' })).toEqual({ username: null, email: null })
    await expect(b.service.signUp('b@example.com', 'x', 'longpassword', true)).rejects.toThrow(/3–20/)
    await expect(b.service.signUp('b@example.com', 'bob', 'short', true)).rejects.toThrow(/8 characters/)
    expect(b.service.state().signedIn).toBe(false)
    // None of the failures created an account: the name and email are still free.
    expect(await b.service.signUp('b@example.com', 'bob', 'longpassword', true)).toMatchObject({ signedIn: true, username: 'bob' })
    b.service.stop()
  })

  it('asks for a username when an account has none yet, and lets you pick one', async () => {
    const { api, env } = await world()
    const app = vanity(env)
    // Sign-up reached the auth server, but the Vanity server went down before the username was saved.
    const flaky = vanity({ http: env.http, fetchFn: async (url, init) => (url.endsWith('/me/username') ? Promise.reject(new TypeError('fetch failed')) : api.fetchFn(url, init)) })
    expect(await flaky.service.signUp('a@example.com', 'alice', 'longpassword', true)).toMatchObject({ signedIn: true, needsUsername: true, username: null })

    expect(await app.service.signIn('a@example.com', 'longpassword', true)).toMatchObject({ signedIn: true, needsUsername: true })
    await expect(app.service.guard((c) => c.friends())).rejects.toThrow(/Choose a username/)
    expect(await app.service.setUsername('alice')).toMatchObject({ needsUsername: false, username: 'alice' })
    app.service.stop()
    expect((await app.service.guard((c) => c.friends())).friends).toEqual([])
  })

  it('signs in with a username as well as an email', async () => {
    const { auth, env } = await world()
    const a = vanity(env)
    await a.service.signUp('a@example.com', 'Alice_1', 'longpassword', true)
    await a.service.signOut()
    // Any capitals; spaces around it don't matter.
    expect(await a.service.signIn('  alice_1 ', 'longpassword', true)).toMatchObject({ signedIn: true, username: 'Alice_1', email: 'a@example.com', remembered: true })
    // It is a real session: the server accepts its tokens, and it survives a restart.
    expect((await a.service.guard((c) => c.me())).username).toBe('Alice_1')
    a.service.stop()
    const restarted = vanity(env, [], a.vault)
    await restarted.service.load()
    expect((await restarted.service.guard((c) => c.friends())).friends).toEqual([])
    restarted.service.stop()
    // The app itself never asked Neon Auth by username, and the email sign-in still goes straight there.
    const before = auth.requests.length
    await a.service.signOut()
    await a.service.signIn('a@example.com', 'longpassword', true)
    expect(auth.requests.slice(before).some((r) => r.path === '/sign-in/email')).toBe(true)
    a.service.stop()
  })

  it('resets a forgotten password with a code sent by email', async () => {
    const { auth, env } = await world()
    const app = vanity(env)
    await app.service.signUp('a@example.com', 'alice', 'old-password', true)
    await app.service.signOut()

    await app.service.sendResetCode('a@example.com')
    const code = auth.codes.get('a@example.com')!
    expect(code).toMatch(/^\d{6}$/)
    await expect(app.service.resetPassword('a@example.com', '000000', 'new-password')).rejects.toThrow(/code is wrong/)
    await expect(app.service.resetPassword('a@example.com', code, 'short')).rejects.toThrow(/8 characters/)
    // Signed in on another device with the old password before the reset.
    await app.service.signIn('a@example.com', 'old-password', true)
    app.service.stop()
    const elsewhere = vanity(env)
    await elsewhere.service.signIn('alice', 'old-password', true)
    elsewhere.service.stop()
    await app.service.signOut()
    // Asking for an address nobody has reads exactly the same as a real one: no error, no code sent.
    await expect(app.service.sendResetCode('nobody@example.com')).resolves.toBeUndefined()
    expect(auth.codes.has('nobody@example.com')).toBe(false)
    await expect(app.service.resetPassword('nobody@example.com', '123456', 'new-password')).rejects.toThrow(/code is wrong|expired/)

    await app.service.resetPassword('a@example.com', code, 'new-password')
    // Signed in here straight away, and the other device's session is over.
    expect(app.service.state()).toMatchObject({ signedIn: true, username: 'alice' })
    app.service.stop()
    await expect(elsewhere.service.token(true)).rejects.toThrow(/expired/)
    expect(elsewhere.service.state()).toMatchObject({ signedIn: false, sessionExpired: true })

    await expect(app.service.signIn('a@example.com', 'old-password', true)).rejects.toThrow('Incorrect username/email or password.')
    expect(await app.service.signIn('a@example.com', 'new-password', true)).toMatchObject({ signedIn: true, username: 'alice' })
    app.service.stop()
  })

  it('deletes the Vanity profile and signs out', async () => {
    const { env } = await world()
    const app = vanity(env)
    await app.service.signUp('a@example.com', 'temp_user', 'longpassword', true)
    app.service.stop()
    expect(await app.service.deleteAccount()).toMatchObject({ signedIn: false, sessionExpired: false })
    expect(app.vault.saved).toBeNull()
    // The username is free again.
    const other = vanity(env)
    expect(await other.service.signUp('b@example.com', 'temp_user', 'longpassword', true)).toMatchObject({ username: 'temp_user' })
    other.service.stop()
  })

  it("says so when this build has no account service", async () => {
    const app = new AccountService({
      store: { list: () => [], get: () => null } as never,
      fetchFn: async () => new Response('{}'),
      authHttp: async () => ({ status: 200, headers: {}, setCookie: [], body: '{}' }),
      backend: () => ({ authUrl: '', apiUrl: '', origin: ORIGIN }),
      vault: { load: async () => null, save: async () => {} },
      runningGame: () => null,
      onChange: () => {}
    })
    expect(app.state().available).toBe(false)
    await expect(app.signIn('a@example.com', 'longpassword', true)).rejects.toThrow(/not set up/)
  })
})
