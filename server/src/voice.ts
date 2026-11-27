import { randomBytes, createHmac } from 'node:crypto'
import { Hono, type MiddlewareHandler } from 'hono'
import type { FriendVoice, VoiceIceServer, VoicePeer, VoiceRoom, VoiceSignal, VoiceUpdate } from '../../src/shared/voiceProtocol'
import { body, fail, toMs, RING_MS, type Env, type PublicUserFn } from './app'
import type { Sql } from './db'

/** STUN/TURN settings, from the function's environment (TURN is optional). */
export interface IceConfig {
  stun: string[]
  turn: string[]
  /** coturn-style shared secret: each player gets their own login that runs out. Never sent to apps. */
  turnSecret: string
  turnTtlSeconds: number
  turnUsername: string
  turnCredential: string
}

export const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478']

export function iceConfigFromEnv(env: Record<string, string | undefined>): IceConfig {
  const list = (v: string | undefined): string[] =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return {
    stun: env.STUN_URLS === undefined ? DEFAULT_STUN : list(env.STUN_URLS),
    turn: list(env.TURN_URLS),
    turnSecret: env.TURN_SECRET ?? '',
    turnTtlSeconds: Number(env.TURN_TTL_SECONDS) || 6 * 3600,
    turnUsername: env.TURN_USERNAME ?? '',
    turnCredential: env.TURN_CREDENTIAL ?? ''
  }
}

/** The ICE servers for one player, with their own short-lived TURN login when a secret is set. */
export function iceServersFor(config: IceConfig, userId: string, nowMs = Date.now()): VoiceIceServer[] {
  const servers: VoiceIceServer[] = []
  if (config.stun.length) servers.push({ urls: config.stun })
  if (config.turn.length) {
    if (config.turnSecret) {
      const username = `${Math.floor(nowMs / 1000) + config.turnTtlSeconds}:${userId.replace(/:/g, '_').slice(0, 64)}`
      servers.push({ urls: config.turn, username, credential: createHmac('sha1', config.turnSecret).update(username).digest('base64') })
    } else if (config.turnUsername && config.turnCredential) {
      servers.push({ urls: config.turn, username: config.turnUsername, credential: config.turnCredential })
    }
  }
  return servers
}

export interface VoiceDeps {
  sql: Sql
  requireAuth: MiddlewareHandler<Env>
  requireUser: MiddlewareHandler<Env>
  areFriends(a: string, b: string): Promise<boolean>
  publicUser: PublicUserFn
  /** Throws when the account is banned or timed out. */
  canSpeak(userId: string): void
  ice: IceConfig
  /** Requests one account may make to voice routes per minute (checking in, connection details…). */
  rateLimit?: number
  now?: () => number
}

// The same numbers as src/shared/voiceProtocol.ts (only its types are imported, since the deployed
// function is built from this folder alone); test/voice.test.ts checks they match.
export const MAX_ROOM_SIZE = 6
export const VOICE_STALE_MS = 10_000
export const VOICE_GONE_MS = 45_000
export const MAX_SIGNALS_PER_SEND = 40
export const MAX_SDP = 40_000
/** Stream ids are short tokens (WebRTC makes them); anything else is dropped. */
function readStreams(v: unknown): { screen?: string; camera?: string } {
  let o: unknown = v
  if (typeof v === 'string') {
    try {
      o = JSON.parse(v)
    } catch {
      o = null
    }
  }
  const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
  const ok = (x: unknown): x is string => typeof x === 'string' && /^[\w{}-]{1,64}$/.test(x)
  return { ...(ok(r.screen) ? { screen: r.screen } : {}), ...(ok(r.camera) ? { camera: r.camera } : {}) }
}

const MAX_CANDIDATE = 2_000

function validSignal(d: unknown): d is VoiceSignal {
  if (!d || typeof d !== 'object') return false
  const s = d as Record<string, unknown>
  if (s.session !== undefined && (typeof s.session !== 'string' || s.session.length > 40)) return false
  if (s.kind === 'offer' || s.kind === 'answer') return typeof s.sdp === 'string' && s.sdp.length > 0 && s.sdp.length <= MAX_SDP
  if (s.kind === 'ice') {
    const c = s.candidate as Record<string, unknown> | null
    return !!c && typeof c.candidate === 'string' && c.candidate.length <= MAX_CANDIDATE && (c.sdpMid === null || typeof c.sdpMid === 'string') && (c.sdpMLineIndex === null || typeof c.sdpMLineIndex === 'number')
  }
  return false
}

type MemberRow = { user_id: string; username: string; avatar: string | null; style: unknown; muted: boolean; deafened: boolean; sharing: boolean; camera: boolean; streams: string | null; watching: string | null; joined_at: unknown; last_seen: unknown }

/** The chat a direct call between two accounts belongs to (the same as dmChat in src/shared/voiceProtocol.ts). */
export const dmChat = (a: string, b: string): string => `dm:${[a, b].sort().join(':')}`

/**
 * Voice rooms, on the Vanity server. No codes: a room belongs to whoever started it and is seen
 * by their friends (and the friends of everyone in it), who can join, unless it's private
 * (hidden) or locked (seen, closed); invited people can always join. Each account is in one room
 * at most. Apps check in every second or two during a call (`GET /voice/update`), which also
 * delivers the WebRTC connection details other players sent them.
 */
export function voiceRoutes({ sql, requireAuth, requireUser, areFriends, publicUser, canSpeak, ice, rateLimit = 600, now = Date.now }: VoiceDeps): Hono<Env> {
  const app = new Hono<Env>()
  const hits = new Map<string, { count: number; reset: number }>()
  const limit: MiddlewareHandler<Env> = async (c, next) => {
    const me = c.get('userId')
    const t = Date.now()
    const h = hits.get(me)
    if (!h || h.reset < t) hits.set(me, { count: 1, reset: t + 60_000 })
    else if (++h.count > rateLimit) fail(429, 'Voice is busy for your account. Wait a moment.', 'rate_limited')
    await next()
  }
  app.use('*', requireAuth, requireUser, limit)

  /** Removes people who stopped checking in long ago, rooms nobody is in, and old connection details. */
  async function tidy(): Promise<void> {
    await sql`DELETE FROM vanity.voice_members WHERE last_seen < to_timestamp(${(now() - VOICE_GONE_MS) / 1000})`
    await sql`DELETE FROM vanity.voice_rooms r WHERE NOT EXISTS (SELECT 1 FROM vanity.voice_members m WHERE m.room_id = r.id) AND r.created_at < to_timestamp(${(now() - 30_000) / 1000})`
    await sql`DELETE FROM vanity.voice_signals WHERE created_at < to_timestamp(${(now() - 120_000) / 1000})`
    await sql`DELETE FROM vanity.voice_rings WHERE created_at < to_timestamp(${(now() - RING_MS) / 1000})`
  }

  async function roomView(roomId: string): Promise<VoiceRoom | null> {
    const [r] = await sql<{ id: string; host_id: string; private: boolean; locked: boolean; chat: string | null }>`SELECT id, host_id, private, locked, chat FROM vanity.voice_rooms WHERE id = ${roomId}`
    if (!r) return null
    const rows = await sql<MemberRow>`
      SELECT m.user_id, p.username, p.avatar_ref AS avatar, p.style, m.muted, m.deafened, m.sharing, m.camera, m.streams, m.watching, m.joined_at, m.last_seen
      FROM vanity.voice_members m JOIN vanity.profiles p ON p.id = m.user_id
      WHERE m.room_id = ${roomId} ORDER BY m.joined_at, m.user_id`
    const t = now()
    const members: VoicePeer[] = rows.map((m) => ({
      id: m.user_id,
      user: publicUser({ id: m.user_id, username: m.username, avatar: m.avatar, style: m.style }),
      muted: m.muted,
      deafened: m.deafened,
      sharing: m.sharing,
      camera: m.camera,
      streams: readStreams(m.streams),
      connected: t - (toMs(m.last_seen) ?? 0) < VOICE_STALE_MS,
      joinedAt: toMs(m.joined_at) ?? 0,
      // Only counts while that person really is sharing.
      watching: m.watching && rows.some((o) => o.user_id === m.watching && o.sharing) ? m.watching : null
    }))
    const ringing = r.chat
      ? await sql<{ id: string; username: string; avatar: string | null; style: unknown }>`
          SELECT p.id, p.username, p.avatar_ref AS avatar, p.style FROM vanity.voice_rings g JOIN vanity.profiles p ON p.id = g.user_id
          WHERE g.room_id = ${roomId} AND g.created_at > to_timestamp(${(t - RING_MS) / 1000}) ORDER BY p.username`
      : []
    return { id: r.id, hostId: r.host_id, private: r.private, locked: r.locked, members, chat: r.chat, ringing: ringing.map((p) => publicUser(p)) }
  }

  async function myRoomId(me: string): Promise<string | null> {
    const [m] = await sql<{ room_id: string }>`SELECT room_id FROM vanity.voice_members WHERE user_id = ${me}`
    return m?.room_id ?? null
  }

  /** Takes someone out of their room. The host's place passes to whoever joined next; an empty room closes. */
  async function leave(me: string): Promise<void> {
    const roomId = await myRoomId(me)
    if (!roomId) return
    await sql`DELETE FROM vanity.voice_members WHERE user_id = ${me}`
    await sql`DELETE FROM vanity.voice_signals WHERE room_id = ${roomId} AND (to_id = ${me} OR from_id = ${me})`
    const [next] = await sql<{ user_id: string }>`SELECT user_id FROM vanity.voice_members WHERE room_id = ${roomId} ORDER BY joined_at, user_id LIMIT 1`
    if (!next) await sql`DELETE FROM vanity.voice_rooms WHERE id = ${roomId}`
    else await sql`UPDATE vanity.voice_rooms SET host_id = ${next.user_id} WHERE id = ${roomId} AND host_id = ${me}`
  }

  async function update(me: string, after: number): Promise<VoiceUpdate> {
    const roomId = await myRoomId(me)
    // What was fetched last time can go; then the new ones.
    if (after > 0) await sql`DELETE FROM vanity.voice_signals WHERE to_id = ${me} AND id <= ${after}`
    const rows = roomId
      ? await sql<{ id: string | number; from_id: string; data: unknown }>`SELECT id, from_id, data FROM vanity.voice_signals WHERE to_id = ${me} AND room_id = ${roomId} AND id > ${after} ORDER BY id LIMIT 200`
      : []
    return {
      you: me,
      room: roomId ? await roomView(roomId) : null,
      signals: rows.map((r) => ({ id: Number(r.id), from: r.from_id, data: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as VoiceSignal })),
      ice: iceServersFor(ice, me, now())
    }
  }

  /** Whether someone may join a room: invited, or (open and not locked) a friend of someone in it. */
  async function mayJoin(me: string, room: { id: string; private: boolean; locked: boolean; chat?: string | null }): Promise<boolean> {
    // A call belongs to its chat: whoever is in the chat may join it, any time.
    if (room.chat?.startsWith('dm:')) return room.chat.split(':').slice(1).includes(me)
    if (room.chat?.startsWith('group:')) return (await sql`SELECT 1 FROM vanity.chat_group_members WHERE group_id = ${room.chat.slice(6)} AND user_id = ${me}`).length > 0
    const [inv] = await sql`SELECT 1 FROM vanity.voice_invites WHERE room_id = ${room.id} AND user_id = ${me}`
    if (inv) return true
    if (room.private || room.locked) return false
    const members = await sql<{ user_id: string }>`SELECT user_id FROM vanity.voice_members WHERE room_id = ${room.id}`
    for (const m of members) if (await areFriends(me, m.user_id)) return true
    return false
  }

  /** Starts a room (leaving any other). */
  app.post('/rooms', async (c) => {
    const me = c.get('userId')
    const b = await body<{ private: boolean; locked: boolean }>(c)
    canSpeak(me)
    await tidy()
    await leave(me)
    const id = randomBytes(9).toString('base64url')
    await sql`INSERT INTO vanity.voice_rooms (id, host_id, private, locked) VALUES (${id}, ${me}, ${b.private === true}, ${b.locked === true})`
    await sql`INSERT INTO vanity.voice_members (user_id, room_id, last_seen) VALUES (${me}, ${id}, to_timestamp(${now() / 1000}))`
    return c.json(await update(me, 0), 201)
  })

  /** Joins a friend's room. Coming back to the room you're already in is fine (after a dropped connection). */
  app.post('/rooms/:id/join', async (c) => {
    const me = c.get('userId')
    const id = c.req.param('id')
    await tidy()
    const [room] = await sql<{ id: string; private: boolean; locked: boolean; chat: string | null }>`SELECT id, private, locked, chat FROM vanity.voice_rooms WHERE id = ${id}`
    if (!room) fail(404, 'That voice room has closed: everyone left.', 'voice_gone')
    canSpeak(me)
    // Answered: it stops ringing here.
    await sql`DELETE FROM vanity.voice_rings WHERE room_id = ${id} AND user_id = ${me}`
    const current = await myRoomId(me)
    if (current !== id) {
      if (!(await mayJoin(me, room!))) fail(403, room!.locked ? 'That voice room is locked. Ask someone in it to invite you.' : "You can't join that voice room.", 'voice_locked')
      const [n] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.voice_members WHERE room_id = ${id}`
      if ((n?.n ?? 0) >= MAX_ROOM_SIZE) fail(409, `That voice room is full (${MAX_ROOM_SIZE} people).`, 'voice_full')
      await leave(me)
      await sql`INSERT INTO vanity.voice_members (user_id, room_id, last_seen) VALUES (${me}, ${id}, to_timestamp(${now() / 1000}))
        ON CONFLICT (user_id) DO UPDATE SET room_id = excluded.room_id, muted = false, deafened = false, sharing = false, camera = false, streams = '{}', joined_at = now(), last_seen = excluded.last_seen`
      // An invitation is used up once used.
      await sql`DELETE FROM vanity.voice_invites WHERE room_id = ${id} AND user_id = ${me}`
    } else {
      await sql`UPDATE vanity.voice_members SET last_seen = to_timestamp(${now() / 1000}) WHERE user_id = ${me}`
    }
    return c.json(await update(me, 0))
  })

  app.post('/leave', async (c) => {
    await leave(c.get('userId'))
    return c.body(null, 204)
  })

  /** Checking in: keeps your place, and brings the room and the connection details sent to you. */
  app.get('/update', async (c) => {
    const me = c.get('userId')
    const after = Math.max(0, Math.trunc(Number(c.req.query('after')) || 0))
    await sql`UPDATE vanity.voice_members SET last_seen = to_timestamp(${now() / 1000}) WHERE user_id = ${me}`
    // Tidy now and then rather than on every check-in.
    if (Math.random() < 0.1) await tidy()
    return c.json(await update(me, after))
  })

  app.post('/state', async (c) => {
    const b = await body<{ muted: boolean; deafened: boolean; sharing: boolean; camera: boolean; streams: unknown; watching: unknown }>(c)
    const watching = typeof b.watching === 'string' && b.watching.length <= 80 && b.watching !== c.get('userId') ? b.watching : null
    await sql`UPDATE vanity.voice_members SET watching = ${watching}, muted = ${b.muted === true}, deafened = ${b.deafened === true}, sharing = ${b.sharing === true}, camera = ${b.camera === true}, streams = ${JSON.stringify(readStreams(b.streams))}, last_seen = to_timestamp(${now() / 1000}) WHERE user_id = ${c.get('userId')}`
    return c.body(null, 204)
  })

  /**
   * Calls a friend (`friendId`) or a group chat (`groupId`): starts the chat's call and rings
   * everyone else in the chat, or joins the call if one is already going.
   */
  app.post('/call', async (c) => {
    const me = c.get('userId')
    const b = await body<{ friendId: string; groupId: string }>(c)
    canSpeak(me)
    await tidy()
    let chat: string
    let others: string[]
    if (typeof b.groupId === 'string' && b.groupId) {
      const members = await sql<{ user_id: string }>`SELECT user_id FROM vanity.chat_group_members WHERE group_id = ${b.groupId}`
      if (!members.some((m) => m.user_id === me)) fail(404, "That group chat doesn't exist, or you're not in it.", 'no_group')
      chat = `group:${b.groupId}`
      others = members.map((m) => m.user_id).filter((id) => id !== me)
    } else {
      if (typeof b.friendId !== 'string' || !(await areFriends(me, b.friendId))) fail(403, 'You can only call your friends.')
      chat = dmChat(me, b.friendId!)
      others = [b.friendId!]
    }
    const [going] = await sql<{ id: string }>`SELECT r.id FROM vanity.voice_rooms r WHERE r.chat = ${chat} AND EXISTS (SELECT 1 FROM vanity.voice_members m WHERE m.room_id = r.id) ORDER BY r.created_at LIMIT 1`
    let id = going?.id
    if (id) {
      if ((await myRoomId(me)) !== id) {
        const [n] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.voice_members WHERE room_id = ${id}`
        if ((n?.n ?? 0) >= MAX_ROOM_SIZE) fail(409, `That call is full (${MAX_ROOM_SIZE} people).`, 'voice_full')
        await leave(me)
        await sql`INSERT INTO vanity.voice_members (user_id, room_id, last_seen) VALUES (${me}, ${id}, to_timestamp(${now() / 1000}))
          ON CONFLICT (user_id) DO UPDATE SET room_id = excluded.room_id, muted = false, deafened = false, sharing = false, camera = false, streams = '{}', watching = NULL, joined_at = now(), last_seen = excluded.last_seen`
      }
      await sql`DELETE FROM vanity.voice_rings WHERE room_id = ${id} AND user_id = ${me}`
    } else {
      await leave(me)
      id = randomBytes(9).toString('base64url')
      // Hidden from the friends list: it is reached from its chat.
      await sql`INSERT INTO vanity.voice_rooms (id, host_id, private, locked, chat) VALUES (${id}, ${me}, true, false, ${chat})`
      await sql`INSERT INTO vanity.voice_members (user_id, room_id, last_seen) VALUES (${me}, ${id}, to_timestamp(${now() / 1000}))`
    }
    // Rings for everyone in the chat who isn't in the call (again, if they missed it before).
    const inCall = new Set((await sql<{ user_id: string }>`SELECT user_id FROM vanity.voice_members WHERE room_id = ${id}`).map((m) => m.user_id))
    for (const other of others.filter((o) => !inCall.has(o)).slice(0, 25)) {
      await sql`INSERT INTO vanity.voice_rings (room_id, user_id, from_id, created_at) VALUES (${id}, ${other}, ${me}, to_timestamp(${now() / 1000}))
        ON CONFLICT (room_id, user_id) DO UPDATE SET from_id = excluded.from_id, created_at = excluded.created_at`
    }
    return c.json(await update(me, 0), 201)
  })

  /** "Not now": the call stops ringing for you. The caller sees you weren't reached. */
  app.post('/rings/:roomId/decline', async (c) => {
    await sql`DELETE FROM vanity.voice_rings WHERE room_id = ${c.req.param('roomId')} AND user_id = ${c.get('userId')}`
    return c.body(null, 204)
  })

  /** Private and locked: only the host changes them. */
  app.patch('/room', async (c) => {
    const me = c.get('userId')
    const b = await body<{ private: boolean; locked: boolean }>(c)
    const roomId = await myRoomId(me)
    if (!roomId) fail(404, "You're not in a voice room.")
    const [r] = await sql<{ host_id: string }>`SELECT host_id FROM vanity.voice_rooms WHERE id = ${roomId}`
    if (r?.host_id !== me) fail(403, 'Only the person who started the room can change that.')
    if (typeof b.private === 'boolean') await sql`UPDATE vanity.voice_rooms SET private = ${b.private} WHERE id = ${roomId}`
    if (typeof b.locked === 'boolean') await sql`UPDATE vanity.voice_rooms SET locked = ${b.locked} WHERE id = ${roomId}`
    return c.json(await update(me, 0))
  })

  /** Lets a friend into your room even when it's private or locked. */
  app.post('/invite', async (c) => {
    const me = c.get('userId')
    const { userId } = await body<{ userId: string }>(c)
    const roomId = await myRoomId(me)
    if (!roomId) fail(404, "You're not in a voice room.")
    if (typeof userId !== 'string' || !(await areFriends(me, userId))) fail(403, 'You can only invite your friends.')
    await sql`INSERT INTO vanity.voice_invites (room_id, user_id) VALUES (${roomId}, ${userId}) ON CONFLICT DO NOTHING`
    return c.body(null, 204)
  })

  /**
   * Passes connection details to people in the same room: one `{ to, data }`, or several at once
   * as `{ signals: [{ to, data }, …] }`. Details for anyone not in your room are dropped.
   */
  app.post('/signal', async (c) => {
    const me = c.get('userId')
    const b = await body<{ to: string; data: VoiceSignal; signals: { to: string; data: VoiceSignal }[] }>(c)
    const list = (Array.isArray(b.signals) ? b.signals : [{ to: b.to, data: b.data }]) as { to: string; data: VoiceSignal }[]
    if (!list.length || list.length > MAX_SIGNALS_PER_SEND || list.some((s) => !s || typeof s.to !== 'string' || !validSignal(s.data))) fail(400, 'Bad connection details.')
    const roomId = await myRoomId(me)
    if (!roomId) return c.body(null, 204)
    const inRoom = new Set((await sql<{ user_id: string }>`SELECT user_id FROM vanity.voice_members WHERE room_id = ${roomId}`).map((r) => r.user_id))
    for (const s of list) {
      if (s.to === me || !inRoom.has(s.to)) continue
      await sql`INSERT INTO vanity.voice_signals (room_id, from_id, to_id, data) VALUES (${roomId}, ${me}, ${s.to}, ${JSON.stringify(s.data)})`
    }
    return c.body(null, 204)
  })

  return app
}

/**
 * Each friend's voice room, as `me` may see it: not private (unless `me` was invited), with who's
 * in it, and whether `me` can join. People who stopped checking in don't count.
 */
export async function friendsVoice(sql: Sql, me: string, friendIds: string[], nowMs = Date.now()): Promise<Map<string, FriendVoice>> {
  const out = new Map<string, FriendVoice>()
  if (!friendIds.length) return out
  const rows = await sql<{ user_id: string; room_id: string; private: boolean; locked: boolean; invited: boolean }>`
    SELECT m.user_id, m.room_id, r.private, r.locked,
      EXISTS (SELECT 1 FROM vanity.voice_invites i WHERE i.room_id = m.room_id AND i.user_id = ${me}) AS invited
    FROM vanity.voice_members m JOIN vanity.voice_rooms r ON r.id = m.room_id
    WHERE m.user_id = ANY(${friendIds}::text[]) AND m.last_seen > to_timestamp(${(nowMs - VOICE_GONE_MS) / 1000})`
  const roomIds = [...new Set(rows.map((r) => r.room_id))]
  const people = roomIds.length
    ? await sql<{ room_id: string; username: string; sharing: boolean }>`
        SELECT m.room_id, p.username, m.sharing FROM vanity.voice_members m JOIN vanity.profiles p ON p.id = m.user_id
        WHERE m.room_id = ANY(${roomIds}::text[]) AND m.last_seen > to_timestamp(${(nowMs - VOICE_GONE_MS) / 1000}) ORDER BY m.joined_at`
    : []
  for (const r of rows) {
    if (r.private && !r.invited) continue
    const inRoom = people.filter((p) => p.room_id === r.room_id)
    const names = inRoom.map((p) => p.username)
    out.set(r.user_id, { roomId: r.room_id, count: names.length, names: names.slice(0, 4), locked: r.locked, live: inRoom.some((p) => p.sharing), canJoin: (r.invited || !r.locked) && names.length < MAX_ROOM_SIZE })
  }
  return out
}
