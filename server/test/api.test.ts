import { PGlite } from '@electric-sql/pglite'
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { testBackend } from './support/backend'
import { neonAuthVerifier, type VerifyToken } from '../src/auth'
import type { Sql } from '../src/db'
import { DEFAULT_PROFILE_STYLE, PROFILE_AURAS, PROFILE_BANNERS, PROFILE_EFFECTS, PROFILE_FLAIRS, PROFILE_FRAMES, PROFILE_NAME_FONTS, PROFILE_NAME_STYLES, PROFILE_TITLES } from '../../src/shared/profileStyle'
import { DEFAULT_STYLE, STYLE_OPTIONS } from '../src/profileStyle'
import { SCHEMA, schemaStatements } from '../src/schema'

/** Stands in for Neon Auth: a token "t:<id>" belongs to user <id>. The real verifier is tested below. */
const verifyToken: VerifyToken = async (token) => (token.startsWith('t:') ? { id: token.slice(2), email: `${token.slice(2)}@example.com` } : null)

/** Real Postgres (PGlite, in-process). The app creates its own tables on first use. */
async function freshDb(): Promise<{ db: PGlite; sql: Sql; migrate: () => Promise<void> }> {
  const db = new PGlite()
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  // One statement at a time, the way the Neon HTTP driver has to run them.
  const migrate = async (): Promise<void> => {
    for (const statement of schemaStatements()) await db.query(statement)
  }
  return { db, sql, migrate }
}

let app: ReturnType<typeof createApp>
let db: PGlite

async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

/** A signed-in account that has picked its username. */
async function register(username: string): Promise<{ token: string; id: string }> {
  const id = `id-${username.toLowerCase()}`
  const r = await call('PUT', '/me/username', `t:${id}`, { username })
  expect(r.status).toBe(200)
  return { token: `t:${id}`, id }
}

async function befriend(a: { token: string; id: string }, b: { token: string; id: string }, bName: string): Promise<void> {
  await call('POST', '/friends/requests', a.token, { username: bName })
  await call('POST', `/friends/requests/${a.id}/accept`, b.token)
}

beforeEach(async () => {
  const fresh = await freshDb()
  db = fresh.db
  app = createApp({ sql: fresh.sql, verifyToken, migrate: fresh.migrate, lookupRateLimit: 1000 })
})

describe('/api prefix', () => {
  it('serves every route under /api too, with the same auth and errors', async () => {
    const { token } = await register('prefixed')
    expect((await call('GET', '/api/me', token)).json.user.username).toBe('prefixed')
    expect((await call('GET', '/me', token)).json.user.username).toBe('prefixed')
    expect((await call('GET', '/api/me')).status).toBe(401)
    expect((await call('GET', '/api')).json).toMatchObject({ name: 'vanity-api', ok: true })
  })
})

describe('accounts', () => {
  it('knows a signed-in account before and after it picks a username', async () => {
    const before = await call('GET', '/me', 't:u1')
    expect(before.json.user).toEqual({ id: 'u1', email: 'u1@example.com', username: null, avatar: null, bio: '', style: DEFAULT_STYLE, statsVisibility: 'everyone', verified: false, admin: false, usernameChangedAt: null, usernameChangeAt: null, standing: { banned: false, reason: '', timeoutUntil: null } })
    // Everything social needs a username first, and says so in a way the app can act on.
    const friends = await call('GET', '/friends', 't:u1')
    expect([friends.status, friends.json.code]).toEqual([409, 'needs_username'])

    expect((await call('PUT', '/me/username', 't:u1', { username: 'Jordan_99' })).json.user.username).toBe('Jordan_99')
    expect((await call('GET', '/me', 't:u1')).json.user.username).toBe('Jordan_99')
    expect((await call('GET', '/friends', 't:u1')).status).toBe(200)
  })

  it('never stores passwords or emails', async () => {
    await register('alice')
    const { rows } = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'vanity' AND table_name = 'profiles'")
    expect(rows.map((r) => r.column_name).sort()).toEqual(['avatar', 'bio', 'created_at', 'id', 'stats_visibility', 'style', 'username'])
  })

  it('rejects bad and taken usernames with clear messages, and allows renaming', async () => {
    await register('alice')
    expect((await call('PUT', '/me/username', 't:other', { username: 'ALICE' })).status).toBe(409)
    expect((await call('PUT', '/me/username', 't:other', { username: 'a' })).json.error).toMatch(/3–20/)
    expect((await call('PUT', '/me/username', 't:id-alice', { username: 'Alice' })).status).toBe(200) // own name, new capitals
    expect((await call('PUT', '/me/username', 't:id-alice', { username: 'alicia' })).json.user.username).toBe('alicia')
    expect((await call('PUT', '/me/username', 't:other', { username: 'alice' })).status).toBe(200) // now free
  })

  it('says whether a username is free, without signing in', async () => {
    await register('alice')
    expect((await call('GET', '/usernames/Alice')).json).toEqual({ available: false })
    expect((await call('GET', '/usernames/bob')).json).toEqual({ available: true })
    expect((await call('GET', '/usernames/no')).status).toBe(400)
  })

  it('rate-limits username look-ups', async () => {
    const fresh = await freshDb()
    app = createApp({ sql: fresh.sql, verifyToken, migrate: fresh.migrate, lookupRateLimit: 3 })
    for (let i = 0; i < 3; i++) await call('GET', '/usernames/someone')
    expect((await call('GET', '/usernames/someone')).status).toBe(429)
  })

  it('refuses missing and invalid tokens', async () => {
    expect((await call('GET', '/me')).status).toBe(401)
    expect((await call('GET', '/me', 'nonsense')).status).toBe(401)
    expect((await call('PUT', '/me/username', 'nonsense', { username: 'mallory' })).status).toBe(401)
  })

  it('deletes an account and everything with it', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    expect((await call('DELETE', '/me', a.token)).status).toBe(204)
    expect((await call('GET', '/me', a.token)).json.user.username).toBeNull()
    expect((await call('GET', '/friends', b.token)).json.friends).toEqual([])
  })
})

describe('messages between friends', () => {
  it('sends, keeps and returns a conversation in order, for both sides', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    expect((await call('GET', `/friends/${b.id}/messages`, a.token)).json).toEqual({ messages: [], more: false, seenUpTo: null })

    const sent = await call('POST', `/friends/${b.id}/messages`, a.token, { text: '  hey bob!\n\n\n\nfancy a game?  ' })
    expect(sent.status).toBe(201)
    expect(sent.json.message).toMatchObject({ mine: true, text: 'hey bob!\n\nfancy a game?', readAt: null })
    await call('POST', `/friends/${a.id}/messages`, b.token, { text: 'sure, 8pm?' })
    await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'see you then' })

    // Bob's friends list shows what's waiting, before he opens the chat.
    const list = (await call('GET', '/friends', b.token)).json.friends[0]
    expect(list).toMatchObject({ username: 'alice', unread: 2, lastMessage: { text: 'see you then', mine: false } })
    expect((await call('GET', '/friends', a.token)).json.friends[0]).toMatchObject({ unread: 1, lastMessage: { mine: true } })

    const bob = (await call('GET', `/friends/${a.id}/messages`, b.token)).json
    expect(bob.messages.map((m: any) => [m.mine, m.text])).toEqual([[false, 'hey bob!\n\nfancy a game?'], [true, 'sure, 8pm?'], [false, 'see you then']])
    expect(bob.more).toBe(false)
    // Opening it marked Alice's messages as read, and Alice can see that.
    expect((await call('GET', '/friends', b.token)).json.friends[0].unread).toBe(0)
    const alice = (await call('GET', `/friends/${b.id}/messages`, a.token)).json
    expect(alice.messages.map((m: any) => m.mine)).toEqual([true, false, true])
    expect(alice.seenUpTo).toBe(alice.messages[2].id)
    expect(alice.messages[0].readAt).not.toBeNull()
  })

  it('pages back through a long history and fetches only what is new', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    for (let i = 1; i <= 7; i++) await call('POST', `/friends/${b.id}/messages`, a.token, { text: `m${i}` })
    const latest = (await call('GET', `/friends/${a.id}/messages?limit=3`, b.token)).json
    expect(latest.messages.map((m: any) => m.text)).toEqual(['m5', 'm6', 'm7'])
    expect(latest.more).toBe(true)
    const older = (await call('GET', `/friends/${a.id}/messages?limit=3&before=${latest.messages[0].id}`, b.token)).json
    expect(older.messages.map((m: any) => m.text)).toEqual(['m2', 'm3', 'm4'])
    const oldest = (await call('GET', `/friends/${a.id}/messages?limit=3&before=${older.messages[0].id}`, b.token)).json
    expect([oldest.messages.map((m: any) => m.text), oldest.more]).toEqual([['m1'], false])
    await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'm8' })
    expect((await call('GET', `/friends/${a.id}/messages?after=${latest.messages[2].id}`, b.token)).json.messages.map((m: any) => m.text)).toEqual(['m8'])
    expect((await call('GET', `/friends/${a.id}/messages?after=999999`, b.token)).json.messages).toEqual([])
  })

  it('is only between friends, and nobody else can read it', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const eve = await register('eve')
    await befriend(a, b, 'bob')
    await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'secret plan' })
    for (const [method, path, body] of [['GET', `/friends/${a.id}/messages`, undefined], ['GET', `/friends/${b.id}/messages`, undefined], ['POST', `/friends/${a.id}/messages`, { text: 'hi' }]] as const) {
      const r = await call(method, path, eve.token, body)
      expect([r.status, r.json.error]).toEqual([403, 'You can only message your friends.'])
    }
    expect((await call('GET', `/friends/${b.id}/messages`)).status).toBe(401)
    // Eve befriends Bob: she sees her own chat with him, never Alice's.
    await befriend(eve, b, 'bob')
    expect((await call('GET', `/friends/${b.id}/messages`, eve.token)).json.messages).toEqual([])
    // No longer friends: the chat can't be opened, but it is still there if they make up.
    await call('DELETE', `/friends/${b.id}`, a.token)
    expect((await call('GET', `/friends/${b.id}/messages`, a.token)).status).toBe(403)
    await befriend(a, b, 'bob')
    expect((await call('GET', `/friends/${b.id}/messages`, a.token)).json.messages.map((m: any) => m.text)).toEqual(['secret plan'])
  })

  it('refuses empty, huge and too many messages, and stores text as text', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    for (const text of ['', '   \n  ', 42, null]) expect((await call('POST', `/friends/${b.id}/messages`, a.token, { text })).status).toBe(400)
    expect((await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'x'.repeat(2001) })).status).toBe(400)
    expect((await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'x'.repeat(2000) })).status).toBe(201)
    const odd = `<img src=x onerror=alert(1)> '; DROP TABLE vanity.messages; -- 🎮`
    await call('POST', `/friends/${b.id}/messages`, a.token, { text: odd })
    expect((await call('GET', `/friends/${a.id}/messages`, b.token)).json.messages.at(-1).text).toBe(odd)

    const fresh = await freshDb()
    const strict = createApp({ sql: fresh.sql, verifyToken, migrate: fresh.migrate, lookupRateLimit: 1000, messageRateLimit: 3 })
    const send = async (token: string, path: string, body?: unknown, method = 'POST') =>
      strict.request(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    await send('t:x', '/me/username', { username: 'xena' }, 'PUT')
    await send('t:y', '/me/username', { username: 'yuri' }, 'PUT')
    await send('t:x', '/friends/requests', { username: 'yuri' })
    await send('t:y', '/friends/requests/x/accept')
    const codes = []
    for (let i = 0; i < 5; i++) codes.push((await send('t:x', '/friends/y/messages', { text: `m${i}` })).status)
    expect(codes).toEqual([201, 201, 201, 429, 429])
  })

  it('keeps messages for good: nothing deletes them but deleting the account', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'keep me' })
    await call('DELETE', `/friends/${b.id}`, a.token)
    await call('PUT', '/me/username', a.token, { username: 'alice2' })
    expect((await db.query('SELECT body FROM vanity.messages')).rows).toEqual([{ body: 'keep me' }])
  })
})

describe('a friend\'s profile, in detail', () => {
  it('shares totals, streaks, favourites, friends in common and when you became friends', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const c = await register('cara')
    await befriend(a, b, 'bob')
    await befriend(a, c, 'cara')
    await befriend(b, c, 'cara')
    const day = (offset: number): string => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
    await call('POST', '/sync', b.token, {
      deviceId: 'device-pc-0000000001',
      deviceName: 'PC',
      games: [
        { key: 'g:portal-2', name: 'Portal 2', playtimeSeconds: 7200, launches: 9, lastPlayedAt: Date.now() - 1000, firstPlayedAt: Date.now() - 9e9 },
        { key: 'g:hades', name: 'Hades', playtimeSeconds: 3600, launches: 4, lastPlayedAt: Date.now() - 5000, firstPlayedAt: Date.now() - 8e9 }
      ],
      prefs: [
        { key: 'g:portal-2', favorite: true, playStatus: 'completed', userRating: 5, notes: null, updatedAt: Date.now() },
        { key: 'g:hades', favorite: false, playStatus: 'playing', userRating: 4, notes: null, updatedAt: Date.now() }
      ],
      days: [day(0), day(1), day(2), day(10), day(11)],
      badges: { 'first-launch': 1_700_000_000_000 },
      collections: null,
      settings: null,
      summary: { xp: 1200, level: 4 }
    })
    await call('PUT', '/stats', b.token, { games: [{ gameKey: 'g:portal-2', gameName: 'Portal 2', playtimeSeconds: 7200, lastPlayedAt: Date.now() - 1000 }, { gameKey: 'g:hades', gameName: 'Hades', playtimeSeconds: 3600, lastPlayedAt: Date.now() - 5000 }] })
    await call('POST', `/friends/${b.id}/messages`, a.token, { text: 'hi' })

    const s = (await call('GET', `/friends/${b.id}/stats`, a.token)).json
    expect(s).toMatchObject({ username: 'bob', gamesPlayed: 2, totalPlaytimeSeconds: 10800, friendCount: 2, mutualFriends: 1, launches: 13, daysPlayed: 5, currentStreak: 3, bestStreak: 3, finished: 1, averageRating: 4.5, ratedGames: 2, steam: null, messages: { sent: 1, received: 0 } })
    expect(s.top[0]).toMatchObject({ gameName: 'Portal 2', launches: 9, favorite: true, playStatus: 'completed', rating: 5 })
    expect(s.favorites.map((g: any) => g.gameName)).toEqual(['Portal 2'])
    expect(s.playing.map((g: any) => g.gameName)).toEqual(['Hades'])
    expect(s.badgeTimes).toEqual({ 'first-launch': 1_700_000_000_000 })
    expect(typeof s.memberSince).toBe('number')
    expect(typeof s.friendsSince).toBe('number')
    // Their notes are never shared.
    expect(JSON.stringify(s)).not.toContain('notes')
  })

  it('works for a friend who has shared nothing yet', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    expect((await call('GET', `/friends/${b.id}/stats`, a.token)).json).toMatchObject({ gamesPlayed: 0, top: [], favorites: [], playing: [], launches: 0, daysPlayed: 0, currentStreak: 0, bestStreak: 0, averageRating: null, friendCount: 1, mutualFriends: 0, messages: { sent: 0, received: 0, firstAt: null } })
  })
})

describe('one account per username and per email', () => {
  it('never lets two accounts share a username, whatever the capitals, and says it is in use', async () => {
    const a = await register('Jordan_99')
    for (const name of ['Jordan_99', 'jordan_99', 'JORDAN_99']) {
      expect((await call('GET', `/usernames/${name}`)).json).toEqual({ available: false })
      const r = await call('PUT', '/me/username', 't:someone-else', { username: name })
      expect([r.status, r.json.error]).toEqual([409, 'That username is already in use.'])
    }
    // Renaming into someone else's name is refused too; keeping your own is fine.
    const b = await register('bob')
    expect((await call('PUT', '/me/username', b.token, { username: 'JORDAN_99' })).status).toBe(409)
    expect((await call('PUT', '/me/username', a.token, { username: 'jordan_99' })).status).toBe(200)
    // The database itself refuses a duplicate, even if two requests slip past the check together.
    await expect(db.query("INSERT INTO vanity.profiles (id, username) VALUES ('sneaky', 'JoRdAn_99')")).rejects.toThrow()
    expect((await db.query("SELECT count(*)::int AS n FROM vanity.profiles WHERE lower(username) = 'jordan_99'")).rows).toEqual([{ n: 1 }])
  })

  it('says whether an email already has an account, ignoring capitals', async () => {
    // Neon Auth's own table of sign-in accounts, in the same database.
    await db.query('CREATE SCHEMA neon_auth')
    await db.query('CREATE TABLE neon_auth."user" (id text PRIMARY KEY, email text NOT NULL UNIQUE)')
    await db.query("INSERT INTO neon_auth.\"user\" VALUES ('u1', 'taken@example.com')")
    expect((await call('POST', '/emails/check', undefined, { email: 'taken@example.com' })).json).toEqual({ inUse: true })
    expect((await call('POST', '/emails/check', undefined, { email: '  Taken@Example.COM ' })).json).toEqual({ inUse: true })
    expect((await call('POST', '/emails/check', undefined, { email: 'free@example.com' })).json).toEqual({ inUse: false })
    for (const email of ['not an email', '', 42, "x' OR '1'='1"]) expect((await call('POST', '/emails/check', undefined, { email })).status).toBe(400)
  })

  it('leaves it to Neon Auth when its tables cannot be read', async () => {
    expect((await call('POST', '/emails/check', undefined, { email: 'someone@example.com' })).json).toEqual({ inUse: null })
  })
})

describe('signing in with a username', () => {
  it('finds the email privately, signs in at Neon Auth and hands the session back', async () => {
    const seen: string[] = []
    const b = await testBackend({
      emailOfUser: async (id) => (id === 'alice' ? 'alice@mail.test' : null),
      authSignIn: async (email, password) => {
        seen.push(email)
        return password === 'right-password' ? { status: 200, json: { user: { id: 'alice', email, name: 'Alice' } }, setCookie: ['neon-auth.session_token=abc; Path=/'], jwt: 'j.w.t' } : { status: 401, json: { code: 'INVALID_EMAIL_OR_PASSWORD' }, setCookie: [], jwt: null }
      }
    })
    const post = async (body: unknown) => {
      const r = await b.fetchFn('https://x/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return { status: r.status, json: (await r.json()) as Record<string, unknown> }
    }
    await b.fetchFn('https://x/me/username', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer t:alice' }, body: JSON.stringify({ username: 'Alice_1' }) })

    const ok = await post({ username: 'alice_1', password: 'right-password' })
    expect(ok.status).toBe(200)
    expect(ok.json).toEqual({ user: { id: 'alice', email: 'alice@mail.test', name: 'Alice' }, setCookie: ['neon-auth.session_token=abc; Path=/'], jwt: 'j.w.t' })
    expect(seen).toEqual(['alice@mail.test'])

    // A wrong password, a name nobody has and nonsense all read exactly the same, and never show an email.
    const wrong = await post({ username: 'alice_1', password: 'nope' })
    const nobody = await post({ username: 'nobody_here', password: 'right-password' })
    const junk = await post({ username: "x' OR 1=1", password: 'p' })
    for (const r of [wrong, nobody, junk]) {
      expect(r.status).toBe(401)
      expect(r.json).toEqual({ error: 'Incorrect username/email or password.' })
    }
    expect(seen).toEqual(['alice@mail.test', 'alice@mail.test'])
  })

  it('pauses a username after too many wrong passwords, and is off without Neon Auth', async () => {
    const b = await testBackend({ signInRateLimit: 3, emailOfUser: async () => 'a@mail.test', authSignIn: async () => ({ status: 401, json: null, setCookie: [], jwt: null }) })
    const post = async (fetchFn: typeof b.fetchFn, username: string) => (await fetchFn('https://x/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'guess' }) })).status
    await b.fetchFn('https://x/me/username', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer t:alice' }, body: JSON.stringify({ username: 'alice' }) })
    expect([await post(b.fetchFn, 'alice'), await post(b.fetchFn, 'alice'), await post(b.fetchFn, 'ALICE'), await post(b.fetchFn, 'alice')]).toEqual([401, 401, 401, 429])
    expect(await post(b.fetchFn, 'someone_else')).toBe(401)
    const off = await testBackend()
    expect(await post(off.fetchFn, 'alice')).toBe(409)
  })
})

describe('profile picture, bio and official badges', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

  it('saves, changes and removes a picture and a bio', async () => {
    const a = await register('alice')
    const set = await call('PUT', '/me/profile', a.token, { avatar: PNG, bio: '  Hello\n\nthere  ' })
    expect(set.status).toBe(200)
    expect(set.json.user).toMatchObject({ username: 'alice', avatar: PNG, bio: 'Hello there' })
    // Only what is sent changes.
    expect((await call('PUT', '/me/profile', a.token, { bio: 'New bio' })).json.user).toMatchObject({ avatar: PNG, bio: 'New bio' })
    expect((await call('PUT', '/me/profile', a.token, { avatar: null })).json.user).toMatchObject({ avatar: null, bio: 'New bio' })
    expect((await call('GET', '/me', a.token)).json.user).toMatchObject({ avatar: null, bio: 'New bio' })
  })

  it('refuses anything that is not a small image, and bios that are too long', async () => {
    const a = await register('alice')
    for (const avatar of ['https://example.com/a.png', 'data:text/html;base64,PGI+', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,' + 'A'.repeat(70_000), 42]) {
      expect((await call('PUT', '/me/profile', a.token, { avatar })).status).toBe(400)
    }
    expect((await call('PUT', '/me/profile', a.token, { bio: 'x'.repeat(201) })).status).toBe(400)
    expect((await call('PUT', '/me/profile', a.token, { bio: 'x'.repeat(200) })).status).toBe(200)
    expect((await call('PUT', '/me/profile', 't:nobody', { bio: 'hi' })).status).toBe(409) // no username yet
    expect((await call('PUT', '/me/profile', undefined, { bio: 'hi' })).status).toBe(401)
  })

  it('shows pictures, bios and badges to friends', async () => {
    const boss = await register('sbcvanity') // capitals don't matter
    const bob = await register('bob')
    await call('PUT', '/me/profile', boss.token, { avatar: PNG, bio: 'I make Vanity.' })
    expect((await call('GET', '/me', boss.token)).json.user).toMatchObject({ verified: true, admin: true })
    expect((await call('GET', '/me', bob.token)).json.user).toMatchObject({ verified: false, admin: false })

    await call('POST', '/friends/requests', boss.token, { username: 'bob' })
    expect((await call('GET', '/friends', bob.token)).json.incoming[0]).toMatchObject({ username: 'sbcvanity', avatar: PNG, verified: true, admin: true })
    expect((await call('GET', '/friends', boss.token)).json.outgoing[0]).toMatchObject({ username: 'bob', avatar: null, verified: false, admin: false })
    await call('POST', `/friends/requests/${boss.id}/accept`, bob.token)
    expect((await call('GET', '/friends', bob.token)).json.friends[0]).toMatchObject({ username: 'sbcvanity', avatar: PNG, bio: 'I make Vanity.', verified: true, admin: true })
    expect((await call('GET', `/friends/${boss.id}/stats`, bob.token)).json).toMatchObject({ avatar: PNG, bio: 'I make Vanity.', verified: true, admin: true })
    expect((await call('GET', `/friends/${bob.id}/stats`, boss.token)).json).toMatchObject({ avatar: null, bio: '', verified: false, admin: false })
  })

  it('saves a profile look from the fixed lists, shows it to friends, and refuses anything else', async () => {
    const a = await register('alice')
    const b = await register('bob')
    expect((await call('GET', '/me', a.token)).json.user.style).toEqual(DEFAULT_STYLE)
    const set = await call('PUT', '/me/profile', a.token, { style: { banner: 'aurora', frame: 'rainbow', nameStyle: 'neon', flair: '🔥' } })
    expect(set.json.user.style).toEqual({ ...DEFAULT_STYLE, banner: 'aurora', frame: 'rainbow', nameStyle: 'neon', flair: '🔥' })
    // Only what is sent changes.
    expect((await call('PUT', '/me/profile', a.token, { style: { frame: 'gold' } })).json.user.style).toEqual({ ...DEFAULT_STYLE, banner: 'aurora', frame: 'gold', nameStyle: 'neon', flair: '🔥' })
    expect((await call('PUT', '/me/profile', a.token, { bio: 'hi' })).json.user.style.banner).toBe('aurora')
    // The newer looks: name font, aura, banner effect and title, each from a fixed list.
    const more = await call('PUT', '/me/profile', a.token, { style: { nameFont: 'pixel', aura: 'orbit', effect: 'snow', title: 'Night owl' } })
    expect(more.json.user.style).toMatchObject({ banner: 'aurora', nameFont: 'pixel', aura: 'orbit', effect: 'snow', title: 'Night owl' })
    for (const bad of [{ title: 'anything I like' }, { nameFont: 'Comic Sans' }, { aura: 'x' }, { effect: '' }]) expect((await call('PUT', '/me/profile', a.token, { style: bad })).status).toBe(400)
    await call('PUT', '/me/profile', a.token, { style: { nameFont: 'app', aura: 'none', effect: 'none', title: '' } })

    for (const style of [{ banner: 'url(https://evil.example/x.png)' }, { frame: 'none; color: red' }, { flair: '<b>hi</b>' }, { flair: 'not an emoji' }, { colour: 'red' }, { banner: 7 }, 'aurora', ['aurora'], null]) {
      expect((await call('PUT', '/me/profile', a.token, { style })).status).toBe(400)
    }
    expect((await call('GET', '/me', a.token)).json.user.style.frame).toBe('gold')

    await call('POST', '/friends/requests', a.token, { username: 'bob' })
    expect((await call('GET', '/friends', b.token)).json.incoming[0].style).toMatchObject({ banner: 'aurora', frame: 'gold' })
    await call('POST', `/friends/requests/${a.id}/accept`, b.token)
    expect((await call('GET', '/friends', b.token)).json.friends[0].style).toEqual({ ...DEFAULT_STYLE, banner: 'aurora', frame: 'gold', nameStyle: 'neon', flair: '🔥' })
    expect((await call('GET', `/friends/${a.id}/stats`, b.token)).json.style).toMatchObject({ nameStyle: 'neon', flair: '🔥' })
    expect((await call('GET', '/friends', a.token)).json.friends[0].style).toEqual(DEFAULT_STYLE)
  })

  it('knows exactly the looks the app offers', () => {
    expect(STYLE_OPTIONS.banner).toEqual(PROFILE_BANNERS.map((x) => x.id))
    expect(STYLE_OPTIONS.frame).toEqual(PROFILE_FRAMES.map((x) => x.id))
    expect(STYLE_OPTIONS.nameStyle).toEqual(PROFILE_NAME_STYLES.map((x) => x.id))
    expect(STYLE_OPTIONS.flair).toEqual([...PROFILE_FLAIRS])
    expect(STYLE_OPTIONS.nameFont).toEqual(PROFILE_NAME_FONTS.map((x) => x.id))
    expect(STYLE_OPTIONS.aura).toEqual(PROFILE_AURAS.map((x) => x.id))
    expect(STYLE_OPTIONS.effect).toEqual(PROFILE_EFFECTS.map((x) => x.id))
    expect(STYLE_OPTIONS.title).toEqual([...PROFILE_TITLES])
    expect(DEFAULT_STYLE).toEqual(DEFAULT_PROFILE_STYLE)
  })

  it('tells a running app its badges every time it checks in, so new ones arrive without an update', async () => {
    const max = await register('max') // capitals don't matter
    const bob = await register('bob')
    const beat = await call('PUT', '/presence', max.token, { gameKey: null })
    expect([beat.status, beat.json]).toEqual([200, { verified: true, admin: false }])
    expect((await call('PUT', '/presence', bob.token, { gameKey: 'steam:620', gameName: 'Portal 2', startedAt: Date.now() })).json).toEqual({ verified: false, admin: false })
    expect((await call('GET', '/me', max.token)).json.user).toMatchObject({ verified: true, admin: false })
  })

  it('cannot be claimed from the app: badges come only from the server list', async () => {
    const a = await register('alice')
    const r = await call('PUT', '/me/profile', a.token, { bio: 'hi', verified: true, admin: true })
    expect(r.json.user).toMatchObject({ verified: false, admin: false })
    // The badge name is taken by its owner, so nobody can rename themselves into it.
    await register('SBCVanity')
    expect((await call('PUT', '/me/username', a.token, { username: 'sbcvanity' })).status).toBe(409)
  })
})

describe('Neon Auth tokens', () => {
  it('accepts tokens signed by the auth server and nothing else', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
    const other = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
    const verify = neonAuthVerifier(createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'EdDSA' }] }))
    const sign = (key: Parameters<SignJWT['sign']>[0], exp: string | number, sub = 'user-1') =>
      new SignJWT({ email: 'a@b.co', name: 'Ann' }).setProtectedHeader({ alg: 'EdDSA', kid: 'k1' }).setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(key)

    expect(await verify(await sign(privateKey, '15m'))).toEqual({ id: 'user-1', email: 'a@b.co' })
    expect(await verify(await sign(other.privateKey, '15m'))).toBeNull() // someone else's key
    expect(await verify(await sign(privateKey, Math.floor(Date.now() / 1000) - 60))).toBeNull() // expired
    expect(await verify('a.b.c')).toBeNull()
    expect(await verify(await sign(privateKey, '15m', ''))).toBeNull() // no user id
  })
})

describe('friends', () => {
  it('sends, lists, accepts and removes friend requests', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const sent = await call('POST', '/friends/requests', a.token, { username: 'BOB' })
    expect(sent.json.status).toBe('pending')
    expect((await call('GET', '/friends', a.token)).json.outgoing.map((r: any) => r.username)).toEqual(['bob'])
    expect((await call('GET', '/friends', b.token)).json.incoming.map((r: any) => r.username)).toEqual(['alice'])

    expect((await call('POST', `/friends/requests/${a.id}/accept`, b.token)).json.status).toBe('accepted')
    const list = (await call('GET', '/friends', a.token)).json
    expect(list.friends.map((f: any) => f.username)).toEqual(['bob'])
    expect(list.outgoing).toEqual([])

    expect((await call('DELETE', `/friends/${b.id}`, a.token)).status).toBe(204)
    expect((await call('GET', '/friends', b.token)).json.friends).toEqual([])
  })

  it('accepts automatically when both people ask', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await call('POST', '/friends/requests', a.token, { username: 'bob' })
    expect((await call('POST', '/friends/requests', b.token, { username: 'alice' })).json.status).toBe('accepted')
  })

  it('handles unknown users, yourself, duplicates and declines', async () => {
    const a = await register('alice')
    const b = await register('bob')
    expect((await call('POST', '/friends/requests', a.token, { username: 'ghost' })).status).toBe(404)
    expect((await call('POST', '/friends/requests', a.token, { username: 'alice' })).status).toBe(400)
    await call('POST', '/friends/requests', a.token, { username: 'bob' })
    expect((await call('POST', '/friends/requests', a.token, { username: 'bob' })).json.status).toBe('pending')
    await call('DELETE', `/friends/requests/${a.id}`, b.token)
    expect((await call('GET', '/friends', a.token)).json.outgoing).toEqual([])
    expect((await call('POST', `/friends/requests/${a.id}/accept`, b.token)).status).toBe(404)
  })
})

describe('presence and stats', () => {
  it("shows what friends are playing, and when they're offline", async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    const offline = (await call('GET', '/friends', a.token)).json.friends[0].status
    expect(offline.state).toBe('offline')

    await call('PUT', '/presence', b.token, { gameKey: 'steam:620', gameName: 'Portal 2', startedAt: Date.now() - 60_000 })
    let s = (await call('GET', '/friends', a.token)).json.friends[0].status
    expect(s).toMatchObject({ state: 'playing', gameName: 'Portal 2' })
    expect(s.since).toBeGreaterThan(0)

    await call('PUT', '/presence', b.token, { gameKey: null })
    expect((await call('GET', '/friends', a.token)).json.friends[0].status.state).toBe('online')

    await call('DELETE', '/presence', b.token)
    s = (await call('GET', '/friends', a.token)).json.friends[0].status
    expect(s.state).toBe('offline')
    expect(s.lastSeen).toBeGreaterThan(0)

    // A heartbeat older than 3 minutes counts as offline.
    await call('PUT', '/presence', b.token, { gameKey: 'steam:620', gameName: 'Portal 2', startedAt: Date.now() })
    await db.query("UPDATE vanity.presence SET updated_at = now() - interval '10 minutes'")
    expect((await call('GET', '/friends', a.token)).json.friends[0].status.state).toBe('offline')
  })

  it('syncs stats, shares them with friends only, and lists friends who played a game', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const c = await register('carol')
    await befriend(a, b, 'bob')
    const sync = await call('PUT', '/stats', b.token, {
      games: [
        { gameKey: 'steam:620', gameName: 'Portal 2', playtimeSeconds: 7200, lastPlayedAt: Date.now() - 86_400_000 },
        { gameKey: 'name:celeste', gameName: 'Celeste', playtimeSeconds: 3600, lastPlayedAt: Date.now() },
        { gameKey: 'steam:620', gameName: 'Portal 2', playtimeSeconds: 7300, lastPlayedAt: null }, // duplicate: last wins
        { gameKey: '', gameName: 'bad' }
      ]
    })
    expect(sync.json.synced).toBe(2)
    // Re-sync updates rather than duplicates.
    await call('PUT', '/stats', b.token, { games: [{ gameKey: 'name:celeste', gameName: 'Celeste', playtimeSeconds: 4000, lastPlayedAt: Date.now() }] })

    const stats = (await call('GET', `/friends/${b.id}/stats`, a.token)).json
    expect(stats).toMatchObject({ username: 'bob', totalPlaytimeSeconds: 11300, gamesPlayed: 2 })
    expect(stats.top.map((g: any) => g.gameName)).toEqual(['Portal 2', 'Celeste'])
    expect(stats.recent[0].gameName).toBe('Celeste')
    expect((await call('GET', '/friends', a.token)).json.friends[0]).toMatchObject({ totalPlaytimeSeconds: 11300, gamesPlayed: 2, topGame: 'Portal 2' })

    // Profiles are public by default: someone who isn't a friend sees them too.
    expect((await call('GET', `/users/${b.id}/stats`, c.token)).json).toMatchObject({ username: 'bob', gamesPlayed: 2, isFriend: false })
    expect((await call('GET', `/users/${b.id}/stats`, a.token)).json.isFriend).toBe(true)
    expect((await call('GET', '/me', b.token)).json.user.statsVisibility).toBe('everyone')
    // Friends only.
    expect((await call('PUT', '/me/profile', b.token, { statsVisibility: 'friends' })).json.user.statsVisibility).toBe('friends')
    const hidden = await call('GET', `/users/${b.id}/stats`, c.token)
    expect([hidden.status, hidden.json.error]).toEqual([403, 'bob only shows their profile to friends.'])
    expect((await call('GET', `/users/${b.id}/stats`, a.token)).status).toBe(200)
    // Only me.
    await call('PUT', '/me/profile', b.token, { statsVisibility: 'private' })
    expect((await call('GET', `/friends/${b.id}/stats`, a.token)).status).toBe(403)
    expect((await call('GET', `/users/${b.id}/stats`, b.token)).status).toBe(200)
    expect((await call('PUT', '/me/profile', b.token, { statsVisibility: 'world' })).status).toBe(400)
    await call('PUT', '/me/profile', b.token, { statsVisibility: 'everyone' })
    expect((await call('GET', '/users/nobody-here/stats', a.token)).status).toBe(404)
    // Finding players by name.
    expect((await call('GET', '/users/search?q=BO', c.token)).json.users.map((u: any) => u.username)).toEqual(['bob'])
    expect((await call('GET', '/users/search?q=%25', c.token)).json.users).toEqual([])
    expect((await call('GET', '/games/steam%3A620/friends', a.token)).json.friends).toEqual([
      { id: b.id, username: 'bob', avatar: null, style: DEFAULT_STYLE, verified: false, admin: false, playtimeSeconds: 7300, lastPlayedAt: null }
    ])
    expect((await call('GET', '/games/steam%3A620/friends', c.token)).json.friends).toEqual([])
  })

  it('caps sync size and rejects malformed bodies', async () => {
    const a = await register('alice')
    expect((await call('PUT', '/stats', a.token, { nope: true })).status).toBe(400)
    const games = Array.from({ length: 5001 }, (_, i) => ({ gameKey: `k${i}`, gameName: 'x', playtimeSeconds: 1, lastPlayedAt: null }))
    expect((await call('PUT', '/stats', a.token, { games })).status).toBe(400)
  })
})

describe('setup', () => {
  it('creates its tables once, and the schema is safe to apply again', async () => {
    let runs = 0
    const fresh = await freshDb()
    app = createApp({ sql: fresh.sql, verifyToken, migrate: async () => (runs++, fresh.migrate()) })
    await register('alice')
    await register('bob')
    expect(runs).toBe(1)
    await fresh.db.exec(SCHEMA)
    expect((await call('GET', '/me', 't:id-alice')).json.user.username).toBe('alice')
  })

  it('tries again after a failed start', async () => {
    let broken = true
    const fresh = await freshDb()
    app = createApp({
      sql: fresh.sql,
      verifyToken,
      migrate: async () => {
        if (broken) throw new Error('database asleep')
        await fresh.migrate()
      }
    })
    expect((await call('GET', '/me', 't:u1')).status).toBe(500)
    broken = false
    expect((await call('GET', '/me', 't:u1')).status).toBe(200)
  })
})
