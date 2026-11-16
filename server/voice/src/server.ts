import { randomInt } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  MAX_MESSAGE_BYTES,
  MAX_ROOM_SIZE,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  VOICE_PROTOCOL,
  type VoiceClientMessage,
  type VoiceErrorCode,
  type VoiceIceServer,
  type VoicePeer,
  type VoiceServerMessage,
  type VoiceSignal,
  type VoiceUser
} from '../../../src/shared/voiceProtocol'
import { AuthUnavailableError, type VerifyToken } from './auth'

export interface VoiceServerOptions {
  /** Checks a Vanity sign-in token. */
  verify: VerifyToken
  /** Lets people in without an account, by a name they choose (for trying the server out; never in production). */
  allowGuests?: boolean
  /** The STUN/TURN servers to give a player. */
  iceServers(user: VoiceUser): VoiceIceServer[]
  /** How long someone whose connection dropped keeps their place before they count as gone. */
  graceMs?: number
  /** How often the server checks connections are alive. */
  heartbeatMs?: number
  maxRoomSize?: number
  /** Messages one connection may send per 10 seconds. */
  messageLimit?: number
  log?: (line: string) => void
}

interface Member {
  peer: VoicePeer
  socket: Client | null
  /** Removes the member when their connection doesn't come back in time. */
  goneTimer: ReturnType<typeof setTimeout> | null
}

interface Room {
  code: string
  members: Map<string, Member>
  createdAt: number
}

interface Client {
  ws: WebSocket
  user: VoiceUser | null
  room: Room | null
  peerId: string | null
  alive: boolean
  sent: number[]
}

const SESSION = /^[A-Za-z0-9_-]{8,64}$/
const MAX_SDP = 40_000
const MAX_CANDIDATE = 2_000

/** A running voice server: the HTTP server (for the health check and WebSocket upgrades) and its rooms. */
export interface VoiceServer {
  http: Server
  /** For tests and the health check. */
  stats(): { rooms: number; people: number }
  close(): Promise<void>
}

export function createVoiceServer(opts: VoiceServerOptions): VoiceServer {
  const graceMs = opts.graceMs ?? 20_000
  const maxSize = Math.min(opts.maxRoomSize ?? MAX_ROOM_SIZE, 50)
  const messageLimit = opts.messageLimit ?? 300
  const log = opts.log ?? (() => {})
  const rooms = new Map<string, Room>()
  /** Each account has one voice connection: a newer one replaces the older (another device, another window). */
  const byUser = new Map<string, Client>()
  const clients = new Set<Client>()

  const http = createServer((req, res) => {
    // A health check for hosts (and for you, in a browser): GET / says it's running.
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
      res.end(JSON.stringify({ name: 'vanity-voice', ok: true, protocol: VOICE_PROTOCOL, ...stats() }))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('Not found')
  })
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES })

  function stats(): { rooms: number; people: number } {
    let people = 0
    for (const r of rooms.values()) people += r.members.size
    return { rooms: rooms.size, people }
  }

  const send = (c: Client | null, msg: VoiceServerMessage): void => {
    if (c && c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg))
  }
  const fail = (c: Client, code: VoiceErrorCode, message: string): void => send(c, { t: 'error', code, message })
  const broadcast = (room: Room, msg: VoiceServerMessage, except?: string): void => {
    for (const [id, m] of room.members) if (id !== except) send(m.socket, msg)
  }

  function newCode(): string {
    for (;;) {
      let code = ''
      for (let i = 0; i < 6; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]
      if (!rooms.has(code)) return code
    }
  }

  function removeMember(room: Room, id: string): void {
    const m = room.members.get(id)
    if (!m) return
    if (m.goneTimer) clearTimeout(m.goneTimer)
    room.members.delete(id)
    if (m.socket && m.socket.peerId === id) {
      m.socket.room = null
      m.socket.peerId = null
    }
    broadcast(room, { t: 'peer-left', id })
    if (room.members.size === 0) {
      rooms.delete(room.code)
      log(`room ${room.code} closed`)
    }
  }

  /** Leaves the room this connection is in, at once. */
  function leave(c: Client): void {
    if (c.room && c.peerId) removeMember(c.room, c.peerId)
    c.room = null
    c.peerId = null
  }

  function enter(c: Client, room: Room, session: string): void {
    if (!c.user) return
    // Already somewhere else: leave there first.
    if (c.room && c.room !== room) leave(c)
    const existing = room.members.get(session)
    if (existing) {
      // Coming back after a dropped connection: the same place, nobody hears them leave and join.
      if (existing.peer.user.id !== c.user.id) return fail(c, 'bad-request', 'That place in the room belongs to someone else.')
      if (existing.goneTimer) clearTimeout(existing.goneTimer)
      existing.goneTimer = null
      if (existing.socket && existing.socket !== c) {
        existing.socket.room = null
        existing.socket.peerId = null
      }
      existing.socket = c
      existing.peer.connected = true
      c.room = room
      c.peerId = session
      send(c, { t: 'room', code: room.code, you: session, peers: others(room, session), resumed: true })
      broadcast(room, { t: 'peer-state', id: session, muted: existing.peer.muted, deafened: existing.peer.deafened, connected: true }, session)
      return
    }
    // The same account already in this room under another visit (e.g. an old window): that one goes.
    for (const [id, m] of room.members) if (m.peer.user.id === c.user.id) removeMember(room, id)
    if (room.members.size >= maxSize) return fail(c, 'full', `This room is full (${maxSize} people).`)
    const peer: VoicePeer = { id: session, user: c.user, muted: false, deafened: false, connected: true, joinedAt: Date.now() }
    room.members.set(session, { peer, socket: c, goneTimer: null })
    c.room = room
    c.peerId = session
    send(c, { t: 'room', code: room.code, you: session, peers: others(room, session), resumed: false })
    broadcast(room, { t: 'peer-joined', peer }, session)
    log(`${c.user.username} joined ${room.code} (${room.members.size})`)
  }

  const others = (room: Room, me: string): VoicePeer[] => [...room.members.values()].filter((m) => m.peer.id !== me).map((m) => m.peer)

  function validSignal(d: unknown): d is VoiceSignal {
    if (!d || typeof d !== 'object') return false
    const s = d as Record<string, unknown>
    if (s.kind === 'offer' || s.kind === 'answer') return typeof s.sdp === 'string' && s.sdp.length > 0 && s.sdp.length <= MAX_SDP
    if (s.kind === 'ice') {
      const c = s.candidate as Record<string, unknown> | null
      return !!c && typeof c.candidate === 'string' && c.candidate.length <= MAX_CANDIDATE && (c.sdpMid === null || typeof c.sdpMid === 'string') && (c.sdpMLineIndex === null || typeof c.sdpMLineIndex === 'number')
    }
    return false
  }

  async function onMessage(c: Client, msg: VoiceClientMessage): Promise<void> {
    if (msg.t === 'hello') {
      if (msg.v !== VOICE_PROTOCOL) return fail(c, 'version', 'Update Vanity to use voice with this server.')
      if (c.user) return
      let user: VoiceUser | null = null
      if (typeof msg.token === 'string' && msg.token) {
        try {
          user = await opts.verify(msg.token)
        } catch (err) {
          return fail(c, 'server', err instanceof AuthUnavailableError ? err.message : "The voice server couldn't check your sign-in. Try again in a moment.")
        }
        if (!user) return fail(c, 'auth', 'Sign in to Vanity again to use voice.')
      } else if (opts.allowGuests && typeof msg.guest === 'string' && msg.guest.trim()) {
        const name = msg.guest.trim().replace(/[^\p{L}\p{N}_ .-]/gu, '').slice(0, 20) || 'Guest'
        user = { id: `guest:${randomInt(1e9)}`, username: name, avatar: null, style: null, verified: false, admin: false }
      } else {
        return fail(c, 'auth', 'Sign in to Vanity to use voice.')
      }
      if (c.ws.readyState !== c.ws.OPEN) return
      // One voice connection per account.
      const old = byUser.get(user.id)
      if (old && old !== c) {
        fail(old, 'replaced', 'You joined voice somewhere else, so this one was disconnected.')
        if (old.room && old.peerId) {
          // Its place is handed over if the new one rejoins with the same visit; otherwise it goes.
          const m = old.room.members.get(old.peerId)
          if (m) m.socket = null
        }
        old.room = null
        old.peerId = null
        old.ws.close(4001, 'replaced')
      }
      c.user = user
      byUser.set(user.id, c)
      return send(c, { t: 'welcome', you: user, ice: opts.iceServers(user) })
    }
    if (!c.user) return fail(c, 'auth', 'Say hello first.')

    switch (msg.t) {
      case 'create': {
        if (typeof msg.session !== 'string' || !SESSION.test(msg.session)) return fail(c, 'bad-request', 'Bad visit id.')
        const room: Room = { code: newCode(), members: new Map(), createdAt: Date.now() }
        rooms.set(room.code, room)
        log(`room ${room.code} made by ${c.user.username}`)
        return enter(c, room, msg.session)
      }
      case 'join': {
        if (typeof msg.session !== 'string' || !SESSION.test(msg.session)) return fail(c, 'bad-request', 'Bad visit id.')
        const code = typeof msg.code === 'string' ? normalizeRoomCode(msg.code) : null
        let room = code ? rooms.get(code) : undefined
        if (!room && code && msg.resume === true) {
          // Back after the server restarted (or the room emptied while everyone was reconnecting): the same room again.
          room = { code, members: new Map(), createdAt: Date.now() }
          rooms.set(code, room)
          log(`room ${code} made again by ${c.user.username} after a reconnect`)
        }
        if (!room) return fail(c, 'not-found', code ? `There's no room with the code ${code}. Check it, or ask for a new one.` : "That isn't a room code. Codes are 6 letters and numbers.")
        return enter(c, room, msg.session)
      }
      case 'leave':
        return leave(c)
      case 'signal': {
        if (!c.room || !c.peerId) return
        if (typeof msg.to !== 'string' || !validSignal(msg.data)) return fail(c, 'bad-request', 'Bad connection details.')
        const target = c.room.members.get(msg.to)
        if (target && target.peer.id !== c.peerId) send(target.socket, { t: 'signal', from: c.peerId, data: msg.data })
        return
      }
      case 'state': {
        if (!c.room || !c.peerId) return
        const m = c.room.members.get(c.peerId)
        if (!m) return
        m.peer.muted = msg.muted === true
        m.peer.deafened = msg.deafened === true
        return broadcast(c.room, { t: 'peer-state', id: c.peerId, muted: m.peer.muted, deafened: m.peer.deafened, connected: true }, c.peerId)
      }
      case 'ping':
        return send(c, { t: 'pong', at: typeof msg.at === 'number' ? msg.at : 0 })
      default:
        return fail(c, 'bad-request', 'Unknown message.')
    }
  }

  wss.on('connection', (ws) => {
    const c: Client = { ws, user: null, room: null, peerId: null, alive: true, sent: [] }
    clients.add(c)
    // Say who you are within 10 seconds, or the connection is closed.
    const helloTimer = setTimeout(() => {
      if (!c.user) ws.close(4000, 'no hello')
    }, 10_000)
    ws.on('pong', () => (c.alive = true))
    ws.on('message', (raw, isBinary) => {
      const now = Date.now()
      c.sent = c.sent.filter((t) => now - t < 10_000)
      c.sent.push(now)
      if (c.sent.length > messageLimit) {
        fail(c, 'rate', 'Too many messages. Slow down a little.')
        return
      }
      if (isBinary) return fail(c, 'bad-request', 'Text messages only.')
      let msg: VoiceClientMessage
      try {
        msg = JSON.parse(String(raw)) as VoiceClientMessage
      } catch {
        return fail(c, 'bad-request', 'Not JSON.')
      }
      if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return fail(c, 'bad-request', 'Unknown message.')
      onMessage(c, msg).catch((err) => {
        log(`error: ${err instanceof Error ? err.message : String(err)}`)
        fail(c, 'server', 'Something went wrong on the voice server.')
      })
    })
    ws.on('close', () => {
      clearTimeout(helloTimer)
      clients.delete(c)
      if (c.user && byUser.get(c.user.id) === c) byUser.delete(c.user.id)
      const room = c.room
      const id = c.peerId
      if (!room || !id) return
      const m = room.members.get(id)
      if (!m || m.socket !== c) return
      // Dropped, not left: keep their place for a little while in case they come back.
      m.socket = null
      m.peer.connected = false
      broadcast(room, { t: 'peer-state', id, muted: m.peer.muted, deafened: m.peer.deafened, connected: false }, id)
      m.goneTimer = setTimeout(() => removeMember(room, id), graceMs)
    })
  })

  // Connections that stopped answering (a sleeping laptop, a pulled cable) are closed.
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate()
        continue
      }
      c.alive = false
      c.ws.ping()
    }
  }, opts.heartbeatMs ?? 25_000)

  return {
    http,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat)
        for (const r of rooms.values()) for (const m of r.members.values()) if (m.goneTimer) clearTimeout(m.goneTimer)
        for (const ws of wss.clients) ws.terminate()
        wss.close(() => http.close(() => resolve()))
      })
  }
}
