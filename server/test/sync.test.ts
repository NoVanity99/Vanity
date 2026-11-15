import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { VerifyToken } from '../src/auth'
import type { Sql } from '../src/db'
import { schemaStatements } from '../src/schema'
import type { SyncRequest, SyncResponse } from '../../src/shared/sync'

const verifyToken: VerifyToken = async (token) => (token.startsWith('t:') ? { id: token.slice(2), email: null } : null)

let app: ReturnType<typeof createApp>

async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

const PC = 'device-pc-0001'
const PHONE = 'device-phone-0002'
const base = (deviceId: string, over: Partial<SyncRequest> = {}): SyncRequest => ({
  deviceId,
  deviceName: deviceId === PC ? 'Gaming PC' : 'Phone',
  games: [],
  prefs: [],
  days: [],
  badges: {},
  collections: null,
  settings: null,
  summary: { xp: 0, level: 1 },
  ...over
})
const sync = async (token: string, req: SyncRequest): Promise<SyncResponse> => {
  const r = await call('POST', '/sync', token, req)
  expect(r.status).toBe(200)
  return r.json
}
const game = (key: string, playtimeSeconds: number, launches = 1, lastPlayedAt: number | null = 1_700_000_000_000) => ({ key, name: key.slice(2), playtimeSeconds, launches, lastPlayedAt, firstPlayedAt: lastPlayedAt })

beforeEach(async () => {
  const db = new PGlite()
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  app = createApp({
    sql,
    verifyToken,
    migrate: async () => {
      for (const statement of schemaStatements()) await db.query(statement)
    },
    syncRateLimit: 1000
  })
  await call('PUT', '/me/username', 't:a', { username: 'alice' })
  await call('PUT', '/me/username', 't:b', { username: 'bob' })
})

describe('playtime and launches', () => {
  it('adds up what each device has played, and tells a device what the others add', async () => {
    await sync('t:a', base(PC, { games: [game('g:portal-2', 3600, 4), game('g:celeste', 600, 1)] }))
    const phone = await sync('t:a', base(PHONE, { games: [game('g:portal-2', 1200, 2, 1_800_000_000_000)] }))
    const portal = phone.games.find((g) => g.key === 'g:portal-2')!
    expect(portal).toMatchObject({ playtimeSeconds: 4800, launches: 6, otherPlaytimeSeconds: 3600, otherLaunches: 4, lastPlayedAt: 1_800_000_000_000, firstPlayedAt: 1_700_000_000_000 })
    // A game only the PC has still reaches the phone.
    expect(phone.games.find((g) => g.key === 'g:celeste')).toMatchObject({ playtimeSeconds: 600, otherPlaytimeSeconds: 600 })

    const pc = await sync('t:a', base(PC, { games: [game('g:portal-2', 3700, 5)] }))
    expect(pc.games.find((g) => g.key === 'g:portal-2')).toMatchObject({ playtimeSeconds: 4900, otherPlaytimeSeconds: 1200, otherLaunches: 2 })
  })

  it('never lowers a counter, even if a device sends less', async () => {
    await sync('t:a', base(PC, { games: [game('g:portal-2', 3600, 4)] }))
    const r = await sync('t:a', base(PC, { games: [game('g:portal-2', 100, 1)] }))
    expect(r.games[0]).toMatchObject({ playtimeSeconds: 3600, launches: 4 })
    // A game the device no longer lists keeps its time.
    const empty = await sync('t:a', base(PC))
    expect(empty.games[0].playtimeSeconds).toBe(3600)
  })

  it('keeps accounts apart', async () => {
    await sync('t:a', base(PC, { games: [game('g:portal-2', 3600)] }))
    expect((await sync('t:b', base(PC))).games).toEqual([])
  })

  it('shows friends the total across devices, with level and badges', async () => {
    await call('POST', '/friends/requests', 't:a', { username: 'bob' })
    await call('POST', '/friends/requests/a/accept', 't:b')
    await sync('t:a', base(PC, { games: [game('g:portal-2', 3600)], badges: { 'first-launch': 1_700_000_000_000 }, summary: { xp: 1234, level: 5 } }))
    await sync('t:a', base(PHONE, { games: [game('g:portal-2', 400)], summary: { xp: 1300, level: 5 } }))
    const list = (await call('GET', '/friends', 't:b')).json.friends[0]
    expect(list).toMatchObject({ username: 'alice', totalPlaytimeSeconds: 4000, level: 5, xp: 1300 })
    const stats = (await call('GET', '/friends/a/stats', 't:b')).json
    expect(stats).toMatchObject({ level: 5, xp: 1300, badges: ['first-launch'], totalPlaytimeSeconds: 4000 })
    // Someone who has never synced is level 1.
    expect((await call('GET', '/friends', 't:a')).json.friends[0]).toMatchObject({ username: 'bob', level: 1, xp: 0 })
  })
})

describe('choices: the server wins unless the device is newer', () => {
  const pref = (updatedAt: number, over = {}) => ({ key: 'g:portal-2', favorite: true, playStatus: 'playing', userRating: 4, notes: 'so good', updatedAt, ...over })
  const T = 1_700_000_000_000

  it('takes a newer change, keeps its own copy against an older or equal one', async () => {
    expect((await sync('t:a', base(PC, { prefs: [pref(T)] }))).prefs[0]).toMatchObject({ favorite: true, playStatus: 'playing', userRating: 4, notes: 'so good', updatedAt: T })
    // Older change from the phone: ignored, and the phone gets the server's copy back.
    expect((await sync('t:a', base(PHONE, { prefs: [pref(T - 5000, { favorite: false, userRating: 1 })] }))).prefs[0]).toMatchObject({ favorite: true, userRating: 4, updatedAt: T })
    // Same moment: the server's copy wins.
    expect((await sync('t:a', base(PHONE, { prefs: [pref(T, { favorite: false })] }))).prefs[0].favorite).toBe(true)
    // Newer: taken.
    expect((await sync('t:a', base(PHONE, { prefs: [pref(T + 1, { favorite: false, playStatus: 'completed', userRating: null, notes: null })] }))).prefs[0]).toMatchObject({
      favorite: false,
      playStatus: 'completed',
      userRating: null,
      notes: null,
      updatedAt: T + 1
    })
  })

  it("doesn't let a clock set in the future win forever", async () => {
    const future = Date.now() + 365 * 86_400_000
    const first = (await sync('t:a', base(PC, { prefs: [pref(future)] }))).prefs[0]
    expect(first.updatedAt).toBeLessThanOrEqual(Date.now())
    await new Promise((r) => setTimeout(r, 5))
    expect((await sync('t:a', base(PHONE, { prefs: [pref(Date.now(), { favorite: false })] }))).prefs[0].favorite).toBe(false)
  })

  it('cleans up bad values', async () => {
    const r = await sync('t:a', base(PC, { prefs: [pref(T, { playStatus: 'nonsense', userRating: 9, notes: '   ' }), { key: '', favorite: true } as never] }))
    expect(r.prefs).toEqual([{ key: 'g:portal-2', favorite: true, playStatus: null, userRating: null, notes: null, updatedAt: T }])
  })

  it('syncs collections and settings the same way, as a whole', async () => {
    const mine = { updatedAt: T, items: [{ name: 'Co-op', games: ['g:portal-2', 'g:portal-2', 'g:it-takes-two'] }, { name: 'co-op', games: [] }, { name: '  ', games: [] }] }
    const a = await sync('t:a', base(PC, { collections: mine, settings: { updatedAt: T, values: { theme: 'ocean', font: 'retro', musicFolder: 'C:\\Music', controllerEnabled: true } as never } }))
    expect(a.collections).toEqual({ updatedAt: T, items: [{ name: 'Co-op', games: ['g:portal-2', 'g:it-takes-two'] }] })
    // Only look-and-feel settings are kept: never folders or paths.
    expect(a.settings).toEqual({ updatedAt: T, values: { theme: 'ocean', font: 'retro', controllerEnabled: true } })

    // A device that has never changed them only receives.
    const phone = await sync('t:a', base(PHONE))
    expect(phone.collections?.items[0].name).toBe('Co-op')
    expect(phone.settings?.values.theme).toBe('ocean')

    // Older edits lose, newer ones replace the lot (so a deleted collection stays deleted).
    expect((await sync('t:a', base(PHONE, { collections: { updatedAt: T - 1, items: [] }, settings: { updatedAt: T - 1, values: { theme: 'royal' } } }))).collections?.items).toHaveLength(1)
    const newer = await sync('t:a', base(PHONE, { collections: { updatedAt: T + 1, items: [] }, settings: { updatedAt: T + 1, values: { theme: 'royal' } } }))
    expect(newer.collections).toEqual({ updatedAt: T + 1, items: [] })
    expect(newer.settings).toEqual({ updatedAt: T + 1, values: { theme: 'royal' } })
  })
})

describe('days and badges only ever grow', () => {
  it('merges the days played on each device', async () => {
    await sync('t:a', base(PC, { days: ['2026-11-01', '2026-11-02', 'not-a-day'] }))
    const r = await sync('t:a', base(PHONE, { days: ['2026-11-02', '2026-11-03'] }))
    expect(r.days).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
    expect((await sync('t:a', base(PC))).days).toHaveLength(3)
  })

  it('keeps the earliest time a badge was unlocked', async () => {
    await sync('t:a', base(PC, { badges: { 'first-launch': 2000, 'hours-10': 5000 } }))
    const r = await sync('t:a', base(PHONE, { badges: { 'first-launch': 1000, 'hours-10': 9000, 'BAD ID': 1, 'streak-3': 7000 } }))
    expect(r.badges).toEqual({ 'first-launch': 1000, 'hours-10': 5000, 'streak-3': 7000 })
  })
})

describe('limits', () => {
  it('needs a sign-in, a username and a sane request', async () => {
    expect((await call('POST', '/sync', undefined, base(PC))).status).toBe(401)
    expect((await call('POST', '/sync', 't:new', base(PC))).json.code).toBe('needs_username')
    expect((await call('POST', '/sync', 't:a', { ...base(PC), deviceId: 'x' })).status).toBe(400)
    expect((await call('POST', '/sync', 't:a', { deviceId: PC })).status).toBe(400)
    const many = Array.from({ length: 5001 }, (_, i) => game(`g:${i}`, 1))
    expect((await call('POST', '/sync', 't:a', base(PC, { games: many }))).status).toBe(400)
  })

  it('handles a big library in one go', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => game(`g:game-${i}`, i, 1))
    const r = await sync('t:a', base(PC, { games: many, prefs: many.slice(0, 500).map((g) => ({ key: g.key, favorite: true, playStatus: null, userRating: null, notes: null, updatedAt: 5 })) }))
    expect(r.games).toHaveLength(1500)
    expect(r.prefs).toHaveLength(500)
  })

  it('removes everything with the account', async () => {
    await sync('t:a', base(PC, { games: [game('g:portal-2', 3600)], days: ['2026-11-01'] }))
    await call('DELETE', '/me', 't:a')
    await call('PUT', '/me/username', 't:a', { username: 'alice2' })
    const r = await sync('t:a', base(PC))
    expect([r.games, r.days]).toEqual([[], []])
  })
})

describe('rate limit', () => {
  it('slows down an account that syncs far too often', async () => {
    const db = new PGlite()
    const sql: Sql = async (strings, ...values) => (await db.query(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values)).rows as never
    app = createApp({
      sql,
      verifyToken,
      migrate: async () => {
        for (const statement of schemaStatements()) await db.query(statement)
      },
      syncRateLimit: 3
    })
    await call('PUT', '/me/username', 't:a', { username: 'alice' })
    for (let i = 0; i < 3; i++) expect((await call('POST', '/sync', 't:a', base(PC))).status).toBe(200)
    expect((await call('POST', '/sync', 't:a', base(PC))).status).toBe(429)
    await call('PUT', '/me/username', 't:b', { username: 'bob' })
    expect((await call('POST', '/sync', 't:b', base(PC))).status).toBe(200) // others are unaffected
  })
})
