import { createHmac } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { VerifyToken } from '../src/auth'
import type { Sql } from '../src/db'
import { schemaStatements } from '../src/schema'
import * as shared from '../../src/shared/voiceProtocol'
import * as server from '../src/voice'
import { iceConfigFromEnv, iceServersFor } from '../src/voice'

const verifyToken: VerifyToken = async (token) => (token.startsWith('t:') ? { id: token.slice(2), email: `${token.slice(2)}@example.com` } : null)

let app: ReturnType<typeof createApp>
let db: PGlite
let clock = Date.UTC(2026, 10, 16, 12)

async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

async function register(name: string): Promise<{ token: string; id: string; name: string }> {
  const id = `id-${name}`
  expect((await call('PUT', '/me/username', `t:${id}`, { username: name })).status).toBe(200)
  return { token: `t:${id}`, id, name }
}
async function befriend(a: { token: string; id: string }, b: { token: string; id: string; name: string }): Promise<void> {
  await call('POST', '/friends/requests', a.token, { username: b.name })
  await call('POST', `/friends/requests/${a.id}/accept`, b.token)
}

beforeEach(async () => {
  db = new PGlite()
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  clock = Date.UTC(2026, 10, 16, 12)
  app = createApp({
    sql,
    verifyToken,
    migrate: async () => {
      for (const s of schemaStatements()) await db.query(s)
    },
    lookupRateLimit: 1000,
    voiceIce: iceConfigFromEnv({ STUN_URLS: 'stun:stun.example:3478' }),
    now: () => clock
  })
})

const voiceOf = async (viewer: { token: string }, friendId: string) => (await call('GET', '/friends', viewer.token)).json.friends.find((f: any) => f.id === friendId)?.voice

describe('voice rooms', () => {
  it('start without a code, and friends see who is in them and join', async () => {
    const ann = await register('ann')
    const ben = await register('ben')
    await befriend(ann, ben)
    const start = await call('POST', '/voice/rooms', ann.token, {})
    expect(start.status).toBe(201)
    expect(start.json.room).toMatchObject({ hostId: ann.id, private: false, locked: false, members: [{ id: ann.id, user: { username: 'ann' }, muted: false, connected: true }] })
    expect(start.json.ice).toEqual([{ urls: ['stun:stun.example:3478'] }])
    const roomId = start.json.room.id

    // Ben's friends list shows Ann in voice, with a way in.
    expect(await voiceOf(ben, ann.id)).toEqual({ roomId, count: 1, names: ['ann'], locked: false, live: false, canJoin: true })
    const join = await call('POST', `/voice/rooms/${roomId}/join`, ben.token)
    expect(join.status).toBe(200)
    expect(join.json.room.members.map((m: any) => m.user.username)).toEqual(['ann', 'ben'])
    // And Ann's check-in sees him.
    expect((await call('GET', '/voice/update', ann.token)).json.room.members.map((m: any) => m.id)).toEqual([ann.id, ben.id])
  })

  it('lets friends of anyone in the room join, and nobody else', async () => {
    const ann = await register('ann')
    const ben = await register('ben')
    const cal = await register('cal') // Ben's friend, not Ann's
    const eve = await register('eve') // nobody's friend
    await befriend(ann, ben)
    await befriend(ben, cal)
    const roomId = (await call('POST', '/voice/rooms', ann.token, {})).json.room.id
    expect(await voiceOf(cal, ben.id)).toBeNull() // Ben isn't in it yet
    await call('POST', `/voice/rooms/${roomId}/join`, ben.token)
    expect(await voiceOf(cal, ben.id)).toMatchObject({ roomId, count: 2, names: ['ann', 'ben'], canJoin: true })
    expect((await call('POST', `/voice/rooms/${roomId}/join`, cal.token)).status).toBe(200)
    const nope = await call('POST', `/voice/rooms/${roomId}/join`, eve.token)
    expect(nope.status).toBe(403)
  })

  it('private rooms are hidden and locked rooms are closed, but invited friends get in', async () => {
    const ann = await register('ann')
    const ben = await register('ben')
    const cal = await register('cal')
    await befriend(ann, ben)
    await befriend(ann, cal)
    const roomId = (await call('POST', '/voice/rooms', ann.token, { private: true })).json.room.id
    expect(await voiceOf(ben, ann.id)).toBeNull() // hidden
    expect((await call('POST', `/voice/rooms/${roomId}/join`, ben.token)).status).toBe(403)
    expect((await call('POST', '/voice/invite', ann.token, { userId: ben.id })).status).toBe(204)
    expect(await voiceOf(ben, ann.id)).toMatchObject({ roomId, canJoin: true }) // invited: shown to him
    expect(await voiceOf(cal, ann.id)).toBeNull() // still hidden from others
    expect((await call('POST', `/voice/rooms/${roomId}/join`, ben.token)).status).toBe(200)

    // Locked: seen, but closed.
    expect((await call('PATCH', '/voice/room', ann.token, { private: false, locked: true })).json.room).toMatchObject({ private: false, locked: true })
    expect(await voiceOf(cal, ann.id)).toMatchObject({ roomId, locked: true, canJoin: false })
    const locked = await call('POST', `/voice/rooms/${roomId}/join`, cal.token)
    expect([locked.status, locked.json.error]).toEqual([403, 'That voice room is locked. Ask someone in it to invite you.'])
    // Only the host changes it.
    expect((await call('PATCH', '/voice/room', ben.token, { locked: false })).status).toBe(403)
    await call('POST', '/voice/invite', ann.token, { userId: cal.id })
    expect((await call('POST', `/voice/rooms/${roomId}/join`, cal.token)).status).toBe(200)
    // Invites are for friends only.
    const eve = await register('eve')
    expect((await call('POST', '/voice/invite', ann.token, { userId: eve.id })).status).toBe(403)
  })

  it('passes connection details to the person they are for, once, in order', async () => {
    const ann = await register('ann')
    const ben = await register('ben')
    await befriend(ann, ben)
    const roomId = (await call('POST', '/voice/rooms', ann.token, {})).json.room.id
    await call('POST', `/voice/rooms/${roomId}/join`, ben.token)
    for (const data of [{ kind: 'offer', sdp: 'v=0 offer' }, { kind: 'ice', candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } }]) {
      expect((await call('POST', '/voice/signal', ben.token, { to: ann.id, data })).status).toBe(204)
    }
    const first = (await call('GET', '/voice/update', ann.token)).json
    expect(first.signals.map((s: any) => [s.from, s.data.kind])).toEqual([[ben.id, 'offer'], [ben.id, 'ice']])
    expect((await call('GET', '/voice/update', ben.token)).json.signals).toEqual([]) // not for him
    // Several at once.
    const batch = [{ to: ann.id, data: { kind: 'ice', candidate: { candidate: 'candidate:2', sdpMid: '0', sdpMLineIndex: 0 } } }, { to: ann.id, data: { kind: 'ice', candidate: { candidate: 'candidate:3', sdpMid: '0', sdpMLineIndex: 0 } } }]
    expect((await call('POST', '/voice/signal', ben.token, { signals: batch })).status).toBe(204)
    expect((await call('POST', '/voice/signal', ben.token, { signals: Array(41).fill(batch[0]) })).status).toBe(400)
    const more = (await call('GET', `/voice/update?after=${first.signals.at(-1).id}`, ann.token)).json.signals
    expect(more.map((s: any) => s.data.candidate.candidate)).toEqual(['candidate:2', 'candidate:3'])
    const last = more.at(-1).id
    expect((await call('GET', `/voice/update?after=${last}`, ann.token)).json.signals).toEqual([])
    // Nonsense is refused; details for someone not in the room go nowhere.
    expect((await call('POST', '/voice/signal', ben.token, { to: ann.id, data: { kind: 'offer', sdp: 'x'.repeat(50_000) } })).status).toBe(400)
    const eve = await register('eve')
    await call('POST', '/voice/signal', ben.token, { to: eve.id, data: { kind: 'offer', sdp: 'v=0' } })
    expect((await call('GET', '/voice/update', eve.token)).json).toMatchObject({ room: null, signals: [] })
  })

  it('shares mute and deafen, and shows dropped people as reconnecting, then takes them out', async () => {
    const ann = await register('ann')
    const ben = await register('ben')
    await befriend(ann, ben)
    const roomId = (await call('POST', '/voice/rooms', ann.token, {})).json.room.id
    await call('POST', `/voice/rooms/${roomId}/join`, ben.token)
    await call('POST', '/voice/state', ben.token, { muted: true, deafened: true, sharing: true, camera: true, streams: { screen: '{abc-123}', camera: 'cam-1', evil: 'x', other: '<script>' } })
    const ben1 = (await call('GET', '/voice/update', ann.token)).json.room.members[1]
    expect(ben1).toMatchObject({ muted: true, deafened: true, sharing: true, camera: true, streams: { screen: '{abc-123}', camera: 'cam-1' }, connected: true })
    expect(Object.keys(ben1.streams)).toEqual(['screen', 'camera'])
    expect(await voiceOf(ann, ben.id)).toMatchObject({ live: true })
    clock += 15_000 // Ben's app stops checking in
    expect((await call('GET', '/voice/update', ann.token)).json.room.members[1]).toMatchObject({ connected: false })
    // Coming back in time: the same place.
    expect((await call('GET', '/voice/update', ben.token)).json.room.members.map((m: any) => m.connected)).toEqual([true, true])
    clock += 60_000
    await call('GET', '/voice/update', ann.token)
    clock += 1_000
    await call('POST', '/voice/rooms', ann.token, {}) // anything that tidies
    expect(await voiceOf(ann, ben.id)).toBeNull()
  })

  it('hands the room to the next person when the host leaves, and closes it when empty', async () => {
    const ann = await register('ann')
    const ben = await register('ben')
    await befriend(ann, ben)
    const roomId = (await call('POST', '/voice/rooms', ann.token, {})).json.room.id
    await call('POST', `/voice/rooms/${roomId}/join`, ben.token)
    expect((await call('POST', '/voice/leave', ann.token)).status).toBe(204)
    expect((await call('GET', '/voice/update', ben.token)).json.room).toMatchObject({ hostId: ben.id, members: [{ id: ben.id }] })
    await call('POST', '/voice/leave', ben.token)
    expect((await db.query('SELECT count(*)::int AS n FROM vanity.voice_rooms')).rows).toEqual([{ n: 0 }])
    const gone = await call('POST', `/voice/rooms/${roomId}/join`, ann.token)
    expect([gone.status, gone.json.error]).toEqual([404, 'That voice room has closed: everyone left.'])
  })

  it('keeps one room per person and caps rooms at six', async () => {
    const host = await register('host')
    const roomId = (await call('POST', '/voice/rooms', host.token, {})).json.room.id
    const others = []
    for (let i = 1; i <= 6; i++) {
      const p = await register(`player${i}`)
      await befriend(host, p)
      others.push(p)
    }
    for (const p of others.slice(0, 5)) expect((await call('POST', `/voice/rooms/${roomId}/join`, p.token)).status).toBe(200)
    expect(await voiceOf(others[5], host.id)).toMatchObject({ count: 6, canJoin: false })
    const full = await call('POST', `/voice/rooms/${roomId}/join`, others[5].token)
    expect([full.status, full.json.error]).toEqual([409, 'That voice room is full (6 people).'])
    // Starting another room takes you out of the first.
    await call('POST', '/voice/rooms', others[0].token, {})
    expect((await call('GET', '/voice/update', host.token)).json.room.members).toHaveLength(5)
  })

  it('needs a signed-in account with a username', async () => {
    expect((await call('GET', '/voice/update')).status).toBe(401)
    expect((await call('POST', '/voice/rooms', 't:nobody', {})).status).toBe(409)
  })
})

describe('TURN logins', () => {
  it('makes a short-lived login per player from the shared secret, and never hands out the secret', () => {
    const cfg = iceConfigFromEnv({ STUN_URLS: '', TURN_URLS: 'turn:t.example:3478, turns:t.example:5349', TURN_SECRET: 's3cret', TURN_TTL_SECONDS: '3600' })
    const ice = iceServersFor(cfg, 'user:1', 1_700_000_000_000)
    expect(ice).toEqual([{ urls: ['turn:t.example:3478', 'turns:t.example:5349'], username: '1700003600:user_1', credential: createHmac('sha1', 's3cret').update('1700003600:user_1').digest('base64') }])
    expect(JSON.stringify(ice)).not.toContain('s3cret')
    expect(iceServersFor(iceConfigFromEnv({}), 'x')[0].urls).toContain('stun:stun.l.google.com:19302')
  })
})

describe('limits', () => {
  it('match the app', () => {
    for (const k of ['MAX_ROOM_SIZE', 'VOICE_STALE_MS', 'VOICE_GONE_MS', 'MAX_SIGNALS_PER_SEND', 'MAX_SDP'] as const) expect([k, server[k]]).toEqual([k, shared[k]])
  })
})
