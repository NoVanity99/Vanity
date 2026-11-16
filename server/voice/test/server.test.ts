import { createHmac } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { normalizeRoomCode, ROOM_CODE, VOICE_PROTOCOL, type VoiceServerMessage, type VoiceUser } from '../../../src/shared/voiceProtocol'
import { AuthUnavailableError, vanityVerifier } from '../src/auth'
import { configFromEnv } from '../src/config'
import { iceServersFor } from '../src/ice'
import { createVoiceServer, type VoiceServer } from '../src/server'

const user = (name: string): VoiceUser => ({ id: `id-${name}`, username: name, avatar: null, style: null, verified: false, admin: false })
/** Tokens are "t:<name>" here; anything else is not a valid sign-in. */
const verify = async (token: string): Promise<VoiceUser | null> => (token.startsWith('t:') ? user(token.slice(2)) : null)

let server: VoiceServer
let url = ''
const sockets: WebSocket[] = []

async function start(over: Partial<Parameters<typeof createVoiceServer>[0]> = {}): Promise<void> {
  server = createVoiceServer({ verify, iceServers: () => [{ urls: ['stun:example.org:3478'] }], graceMs: 300, ...over })
  await new Promise<void>((r) => server.http.listen(0, '127.0.0.1', r))
  url = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}`
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate()
  await server?.close()
})

/** A player: a WebSocket that remembers everything the server said. */
async function player(token: string | null, extra: Record<string, unknown> = {}) {
  const ws = new WebSocket(url)
  sockets.push(ws)
  const got: VoiceServerMessage[] = []
  const waiters: { t: string; resolve: (m: VoiceServerMessage) => void; from: number }[] = []
  let seen = 0
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as VoiceServerMessage
    got.push(m)
    for (const w of [...waiters]) {
      if (m.t === w.t) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve(m)
      }
    }
  })
  await new Promise((r) => ws.once('open', r))
  const send = (m: unknown): void => ws.send(JSON.stringify(m))
  /** The next message of a kind not already taken. */
  const next = <T extends VoiceServerMessage['t']>(t: T, ms = 2000): Promise<Extract<VoiceServerMessage, { t: T }>> => {
    const i = got.findIndex((m, idx) => idx >= seen && m.t === t)
    if (i >= 0) {
      seen = i + 1
      return Promise.resolve(got[i] as Extract<VoiceServerMessage, { t: T }>)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${t} within ${ms} ms; got ${JSON.stringify(got.map((g) => g.t))}`)), ms)
      waiters.push({
        t,
        from: seen,
        resolve: (m) => {
          clearTimeout(timer)
          seen = got.length
          resolve(m as Extract<VoiceServerMessage, { t: T }>)
        }
      })
    })
  }
  if (token !== null) send({ t: 'hello', v: VOICE_PROTOCOL, token, ...extra })
  return { ws, got, send, next }
}

const session = (name: string): string => `session-${name}-0001`

describe('voice signaling server', () => {
  it('says hello back with who you are and the ICE servers to use', async () => {
    await start()
    const a = await player('t:alice')
    const w = await a.next('welcome')
    expect(w).toEqual({ t: 'welcome', you: user('alice'), ice: [{ urls: ['stun:example.org:3478'] }] })
  })

  it('makes a room with a code, lets others join it, and tells everyone who is there', async () => {
    await start()
    const a = await player('t:alice')
    await a.next('welcome')
    a.send({ t: 'create', session: session('a') })
    const room = await a.next('room')
    expect(room.code).toMatch(ROOM_CODE)
    expect(room).toMatchObject({ you: session('a'), peers: [], resumed: false })

    const b = await player('t:bob')
    await b.next('welcome')
    b.send({ t: 'join', code: room.code.toLowerCase().replace(/(...)/, '$1 '), session: session('b') }) // typed loosely
    const bRoom = await b.next('room')
    expect(bRoom.peers.map((p) => p.user.username)).toEqual(['alice'])
    const joined = await a.next('peer-joined')
    expect(joined.peer).toMatchObject({ id: session('b'), user: { username: 'bob' }, muted: false, deafened: false, connected: true })
    expect(server.stats()).toEqual({ rooms: 1, people: 2 })
  })

  it('passes connection details only to the person they are for, marked with who sent them', async () => {
    await start()
    const a = await player('t:alice')
    await a.next('welcome')
    a.send({ t: 'create', session: session('a') })
    const { code } = await a.next('room')
    const b = await player('t:bob')
    const c = await player('t:cara')
    await b.next('welcome')
    await c.next('welcome')
    b.send({ t: 'join', code, session: session('b') })
    c.send({ t: 'join', code, session: session('c') })
    await b.next('room')
    await c.next('room')
    c.send({ t: 'signal', to: session('a'), data: { kind: 'offer', sdp: 'v=0 fake offer' } })
    expect(await a.next('signal')).toEqual({ t: 'signal', from: session('c'), data: { kind: 'offer', sdp: 'v=0 fake offer' } })
    a.send({ t: 'signal', to: session('c'), data: { kind: 'ice', candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 } } })
    expect((await c.next('signal')).from).toBe(session('a'))
    await new Promise((r) => setTimeout(r, 100))
    expect(b.got.filter((m) => m.t === 'signal')).toEqual([])
    // Nonsense is refused, not passed on.
    c.send({ t: 'signal', to: session('a'), data: { kind: 'offer', sdp: 'x'.repeat(50_000) } })
    expect((await c.next('error')).code).toBe('bad-request')
  })

  it('shares mute and deafen, and answers pings', async () => {
    await start()
    const a = await player('t:alice')
    await a.next('welcome')
    a.send({ t: 'create', session: session('a') })
    const { code } = await a.next('room')
    const b = await player('t:bob')
    await b.next('welcome')
    b.send({ t: 'join', code, session: session('b') })
    await b.next('room')
    b.send({ t: 'state', muted: true, deafened: false })
    expect(await a.next('peer-state')).toEqual({ t: 'peer-state', id: session('b'), muted: true, deafened: false, connected: true })
    b.send({ t: 'ping', at: 1234 })
    expect(await b.next('pong')).toEqual({ t: 'pong', at: 1234 })
  })

  it('removes people who leave, and closes the room when it is empty', async () => {
    await start()
    const a = await player('t:alice')
    await a.next('welcome')
    a.send({ t: 'create', session: session('a') })
    const { code } = await a.next('room')
    const b = await player('t:bob')
    await b.next('welcome')
    b.send({ t: 'join', code, session: session('b') })
    await b.next('room')
    b.send({ t: 'leave' })
    expect(await a.next('peer-left')).toEqual({ t: 'peer-left', id: session('b') })
    a.send({ t: 'leave' })
    await new Promise((r) => setTimeout(r, 50))
    expect(server.stats()).toEqual({ rooms: 0, people: 0 })
    b.send({ t: 'join', code, session: session('b') })
    expect(await b.next('error')).toMatchObject({ code: 'not-found' })
  })

  it('keeps a dropped player’s place for a moment, so they come back without anyone hearing them leave', async () => {
    await start({ graceMs: 400 })
    const a = await player('t:alice')
    await a.next('welcome')
    a.send({ t: 'create', session: session('a') })
    const { code } = await a.next('room')
    let b = await player('t:bob')
    await b.next('welcome')
    b.send({ t: 'join', code, session: session('b') })
    await b.next('room')
    await a.next('peer-joined')

    b.ws.terminate() // the connection drops
    expect(await a.next('peer-state')).toMatchObject({ id: session('b'), connected: false })
    b = await player('t:bob')
    await b.next('welcome')
    b.send({ t: 'join', code, session: session('b') })
    expect(await b.next('room')).toMatchObject({ resumed: true, peers: [{ id: session('a') }] })
    expect(await a.next('peer-state')).toMatchObject({ id: session('b'), connected: true })
    await new Promise((r) => setTimeout(r, 500))
    expect(a.got.some((m) => m.t === 'peer-left')).toBe(false)

    // Gone for longer than that: they've left.
    b.ws.terminate()
    expect(await a.next('peer-left', 2000)).toEqual({ t: 'peer-left', id: session('b') })
  })

  it('makes a room again under the same code when people come back after a server restart', async () => {
    await start()
    const a = await player('t:alice')
    await a.next('welcome')
    // The room "4Q69UF" existed before the restart; this server has never seen it.
    a.send({ t: 'join', code: '4Q69UF', session: session('a') })
    expect(await a.next('error')).toMatchObject({ code: 'not-found' }) // a plain join still needs the room
    a.send({ t: 'join', code: '4Q69UF', session: session('a'), resume: true })
    expect(await a.next('room')).toMatchObject({ code: '4Q69UF', peers: [] })
    const b = await player('t:bob')
    await b.next('welcome')
    b.send({ t: 'join', code: '4q69uf', session: session('b'), resume: true })
    expect((await b.next('room')).peers.map((p) => p.user.username)).toEqual(['alice'])
    expect(server.stats()).toEqual({ rooms: 1, people: 2 })
  })

  it('caps rooms at six people', async () => {
    await start()
    const host = await player('t:p0')
    await host.next('welcome')
    host.send({ t: 'create', session: session('p0') })
    const { code } = await host.next('room')
    for (let i = 1; i < 6; i++) {
      const p = await player(`t:p${i}`)
      await p.next('welcome')
      p.send({ t: 'join', code, session: session(`p${i}`) })
      await p.next('room')
    }
    const late = await player('t:late')
    await late.next('welcome')
    late.send({ t: 'join', code, session: session('late') })
    expect(await late.next('error')).toMatchObject({ code: 'full', message: 'This room is full (6 people).' })
  })

  it('refuses people who are not signed in, old app versions, and bad codes', async () => {
    await start()
    const nobody = await player(null)
    nobody.send({ t: 'hello', v: VOICE_PROTOCOL, token: 'forged' })
    expect(await nobody.next('error')).toMatchObject({ code: 'auth' })
    nobody.send({ t: 'create', session: session('x') })
    expect(await nobody.next('error')).toMatchObject({ code: 'auth' })
    const guest = await player(null)
    guest.send({ t: 'hello', v: VOICE_PROTOCOL, guest: 'Sneaky' })
    expect(await guest.next('error')).toMatchObject({ code: 'auth' }) // guests are off unless allowed
    const old = await player(null)
    old.send({ t: 'hello', v: 0, token: 't:old' })
    expect(await old.next('error')).toMatchObject({ code: 'version' })
    const a = await player('t:alice')
    await a.next('welcome')
    a.send({ t: 'join', code: 'nope', session: session('a') })
    expect((await a.next('error')).message).toMatch(/isn't a room code/)
    a.send({ t: 'join', code: 'ABCDEF', session: 'x' })
    expect(await a.next('error')).toMatchObject({ code: 'bad-request' })
  })

  it('says so when the account server cannot be reached', async () => {
    await start({ verify: async () => { throw new AuthUnavailableError("The voice server couldn't reach Vanity's account server.") } })
    const a = await player('t:alice')
    expect(await a.next('error')).toEqual({ t: 'error', code: 'server', message: "The voice server couldn't reach Vanity's account server." })
  })

  it('lets guests in by name when allowed (for trying it out)', async () => {
    await start({ allowGuests: true })
    const g = await player(null)
    g.send({ t: 'hello', v: VOICE_PROTOCOL, guest: '  Tester <b>  ' })
    expect((await g.next('welcome')).you).toMatchObject({ username: 'Tester b', avatar: null })
  })

  it('keeps one voice connection per account: joining elsewhere disconnects the old one', async () => {
    await start()
    const a = await player('t:alice')
    await a.next('welcome')
    a.send({ t: 'create', session: session('a') })
    const { code } = await a.next('room')
    const b = await player('t:bob')
    await b.next('welcome')
    b.send({ t: 'join', code, session: session('b') })
    await b.next('room')
    const b2 = await player('t:bob') // bob on another device
    await b2.next('welcome')
    expect(await b.next('error')).toMatchObject({ code: 'replaced' })
    b2.send({ t: 'join', code, session: session('b2') })
    await b2.next('room')
    // The old place went, the new one is there: Alice sees one Bob.
    expect(await a.next('peer-left')).toMatchObject({ id: session('b') })
    expect((await a.next('peer-joined', 2000)).peer.id).toBe(session('b2'))
  })

  it('slows down a flood of messages', async () => {
    await start({ messageLimit: 5 })
    const a = await player('t:alice')
    await a.next('welcome')
    for (let i = 0; i < 8; i++) a.send({ t: 'ping', at: i })
    expect(await a.next('error')).toMatchObject({ code: 'rate' })
  })

  it('answers a health check over plain HTTP', async () => {
    await start()
    const res = await fetch(url.replace('ws:', 'http:') + '/')
    expect(await res.json()).toEqual({ name: 'vanity-voice', ok: true, protocol: VOICE_PROTOCOL, rooms: 0, people: 0 })
  })
})

describe('room codes', () => {
  it('accepts codes however they are typed, and nothing else', () => {
    expect(normalizeRoomCode(' abc-234 ')).toBe('ABC234')
    expect(normalizeRoomCode('ABC 234')).toBe('ABC234')
    expect(normalizeRoomCode('ABC23')).toBeNull()
    expect(normalizeRoomCode('ABC2340')).toBeNull()
    expect(normalizeRoomCode('ABCDE0')).toBeNull() // 0 and O are never in a code
  })
})

describe('TURN logins', () => {
  const base = { stun: ['stun:s.example:3478'], turn: ['turn:t.example:3478?transport=udp', 'turns:t.example:5349'], turnSecret: '', turnTtlSeconds: 3600, turnUsername: '', turnCredential: '' }

  it('makes a short-lived login per player from the shared secret, the way coturn checks it', () => {
    const ice = iceServersFor({ ...base, turnSecret: 's3cret' }, 'user:1', 1_700_000_000_000)
    expect(ice[0]).toEqual({ urls: ['stun:s.example:3478'] })
    expect(ice[1].urls).toEqual(base.turn)
    expect(ice[1].username).toBe('1700003600:user_1')
    expect(ice[1].credential).toBe(createHmac('sha1', 's3cret').update('1700003600:user_1').digest('base64'))
    expect(JSON.stringify(ice)).not.toContain('s3cret')
  })

  it('uses a fixed login when that is all there is, and no TURN without one', () => {
    expect(iceServersFor({ ...base, turnUsername: 'u', turnCredential: 'p' }, 'x')[1]).toEqual({ urls: base.turn, username: 'u', credential: 'p' })
    expect(iceServersFor(base, 'x')).toHaveLength(1)
  })
})

describe('settings', () => {
  it('needs an account server unless guests are allowed', () => {
    expect(() => configFromEnv({})).toThrow(/VANITY_API_URL/)
    expect(configFromEnv({ ALLOW_GUESTS: 'true' }).allowGuests).toBe(true)
    const c = configFromEnv({ VANITY_API_URL: 'https://api.example', PORT: '9000', TURN_URLS: 'turn:a:3478, turns:a:5349', TURN_SECRET: 'x', STUN_URLS: '' })
    expect(c).toMatchObject({ port: 9000, vanityApiUrl: 'https://api.example', ice: { stun: [], turn: ['turn:a:3478', 'turns:a:5349'], turnSecret: 'x' } })
  })
})

describe('checking a sign-in with the Vanity server', () => {
  it('asks /me, keeps the answer for a while, and refuses accounts without a username', async () => {
    const calls: string[] = []
    const fetchFn = (async (u: string, init?: RequestInit) => {
      const token = String((init?.headers as Record<string, string>).authorization).replace('Bearer ', '')
      calls.push(`${u} ${token}`)
      if (token === 'good') return new Response(JSON.stringify({ user: { id: 'u1', username: 'SBCVanity', avatar: 'data:image/png;base64,AA', style: { frame: 'gold' }, verified: true, admin: true, email: 'private@example.com' } }))
      if (token === 'nameless') return new Response(JSON.stringify({ user: { id: 'u2', username: null } }))
      if (token === 'down') return new Response('oops', { status: 503 })
      return new Response('{}', { status: 401 })
    }) as typeof fetch
    const check = vanityVerifier('https://api.example/', fetchFn)
    const u = await check('good')
    expect(u).toEqual({ id: 'u1', username: 'SBCVanity', avatar: 'data:image/png;base64,AA', style: { frame: 'gold' }, verified: true, admin: true })
    expect(JSON.stringify(u)).not.toContain('private@example.com') // the email is never passed on to other players
    await check('good')
    expect(calls).toEqual(['https://api.example/me good'])
    expect(await check('bad')).toBeNull()
    expect(await check('nameless')).toBeNull()
    await expect(check('down')).rejects.toBeInstanceOf(AuthUnavailableError)
  })
})
