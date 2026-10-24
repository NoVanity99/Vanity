import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { signToken, verifyToken } from '../src/auth'
import type { Sql } from '../src/db'

const SECRET = 'test-secret-that-is-at-least-32-characters-long'

/** Real Postgres (PGlite, in-process) with the real schema. */
async function freshDb(): Promise<{ db: PGlite; sql: Sql }> {
  const db = new PGlite()
  await db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8'))
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  return { db, sql }
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

async function register(username: string, password = 'hunter2hunter2'): Promise<{ token: string; id: string }> {
  const r = await call('POST', '/auth/register', undefined, { username, password })
  expect(r.status).toBe(201)
  return { token: r.json.token, id: r.json.user.id }
}

async function befriend(a: { token: string; id: string }, b: { token: string; id: string }, bName: string): Promise<void> {
  await call('POST', '/friends/requests', a.token, { username: bName })
  await call('POST', `/friends/requests/${a.id}/accept`, b.token)
}

beforeEach(async () => {
  const fresh = await freshDb()
  db = fresh.db
  app = createApp({ sql: fresh.sql, jwtSecret: SECRET, authRateLimit: 1000 })
})

describe('/api prefix', () => {
  it('serves every route under /api too, with the same auth and errors', async () => {
    const r = await call('POST', '/api/auth/register', undefined, { username: 'prefixed', password: 'hunter2hunter2' })
    expect(r.status).toBe(201)
    expect((await call('GET', '/api/me', r.json.token)).json.user.username).toBe('prefixed')
    expect((await call('GET', '/me', r.json.token)).json.user.username).toBe('prefixed')
    expect((await call('GET', '/api/me')).status).toBe(401)
    expect((await call('GET', '/api')).json).toMatchObject({ name: 'vanity-api', ok: true })
  })
})

describe('accounts', () => {
  it('registers, logs in and identifies the user', async () => {
    const { token } = await register('Jordan_99')
    expect((await call('GET', '/me', token)).json.user.username).toBe('Jordan_99')
    const login = await call('POST', '/auth/login', undefined, { username: 'jordan_99', password: 'hunter2hunter2' })
    expect(login.status).toBe(200)
    expect(login.json.user.username).toBe('Jordan_99')
  })

  it('stores scrypt hashes, never the password', async () => {
    await register('alice')
    const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM users')
    expect(rows[0].password_hash).toMatch(/^scrypt\$/)
    expect(rows[0].password_hash).not.toContain('hunter2')
  })

  it('rejects bad input, taken names and wrong passwords with clear messages', async () => {
    await register('alice')
    expect((await call('POST', '/auth/register', undefined, { username: 'ALICE', password: 'longenough1' })).status).toBe(409)
    expect((await call('POST', '/auth/register', undefined, { username: 'a', password: 'longenough1' })).json.error).toMatch(/3–20/)
    expect((await call('POST', '/auth/register', undefined, { username: 'bob', password: 'short' })).json.error).toMatch(/8 characters/)
    const wrong = await call('POST', '/auth/login', undefined, { username: 'alice', password: 'nope-nope-nope' })
    const unknown = await call('POST', '/auth/login', undefined, { username: 'nobody', password: 'nope-nope-nope' })
    expect([wrong.status, unknown.status]).toEqual([401, 401])
    expect(wrong.json.error).toBe(unknown.json.error) // can't probe usernames
  })

  it('refuses missing, forged and expired tokens', async () => {
    expect((await call('GET', '/me')).status).toBe(401)
    const { id } = await register('alice')
    expect((await call('GET', '/me', signToken({ sub: id, username: 'alice' }, 'another-secret-another-secret-123', 60))).status).toBe(401)
    expect((await call('GET', '/me', signToken({ sub: id, username: 'alice' }, SECRET, -1))).status).toBe(401)
    expect(verifyToken('a.b.c', SECRET)).toBeNull()
  })

  it('rate-limits sign-in attempts', async () => {
    const fresh = await freshDb()
    app = createApp({ sql: fresh.sql, jwtSecret: SECRET, authRateLimit: 3 })
    for (let i = 0; i < 3; i++) await call('POST', '/auth/login', undefined, { username: 'x', password: 'y' })
    expect((await call('POST', '/auth/login', undefined, { username: 'x', password: 'y' })).status).toBe(429)
  })

  it('deletes an account and everything with it', async () => {
    const a = await register('alice')
    const b = await register('bob')
    await befriend(a, b, 'bob')
    expect((await call('DELETE', '/me', a.token)).status).toBe(204)
    expect((await call('GET', '/me', a.token)).status).toBe(401)
    expect((await call('GET', '/friends', b.token)).json.friends).toEqual([])
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
    await db.query("UPDATE presence SET updated_at = now() - interval '10 minutes'")
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

    expect((await call('GET', `/friends/${b.id}/stats`, c.token)).status).toBe(403)
    expect((await call('GET', '/games/steam%3A620/friends', a.token)).json.friends).toEqual([
      { id: b.id, username: 'bob', playtimeSeconds: 7300, lastPlayedAt: null }
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
  it('refuses a short JWT secret', () => {
    expect(() => createApp({ sql: (async () => []) as Sql, jwtSecret: 'short' })).toThrow(/32 characters/)
  })
})
