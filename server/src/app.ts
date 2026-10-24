import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth'
import type { Sql } from './db'

export interface AppOptions {
  sql: Sql
  /** At least 32 random characters. Signs session tokens. */
  jwtSecret: string
  /** How long a sign-in lasts. */
  tokenTtlSeconds?: number
  /** Max sign-in/registration attempts per IP per 10 minutes. */
  authRateLimit?: number
}

type Env = { Variables: { userId: string; username: string } }

const USERNAME = /^[A-Za-z0-9_]{3,20}$/
const ONLINE_WINDOW = '3 minutes'
const MAX_STATS = 5000

const fail = (status: 400 | 401 | 403 | 404 | 409 | 429, message: string): never => {
  throw new HTTPException(status, { message })
}

function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' && v) return Date.parse(v)
  if (typeof v === 'number') return v
  return null
}

async function body<T>(c: Context): Promise<Partial<T>> {
  try {
    const b = await c.req.json()
    return b && typeof b === 'object' ? (b as Partial<T>) : {}
  } catch {
    return {}
  }
}

/** Shapes a presence row into what friends see. */
function status(row: { online: boolean; game_name: string | null; started_at: unknown; updated_at: unknown }): {
  state: 'playing' | 'online' | 'offline'
  gameName: string | null
  since: number | null
  lastSeen: number | null
} {
  if (row.online && row.game_name) return { state: 'playing', gameName: row.game_name, since: toMs(row.started_at), lastSeen: toMs(row.updated_at) }
  return { state: row.online ? 'online' : 'offline', gameName: null, since: null, lastSeen: toMs(row.updated_at) }
}

export function createApp({ sql, jwtSecret, tokenTtlSeconds = 30 * 24 * 3600, authRateLimit = 20 }: AppOptions): Hono<Env> {
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.')
  const app = new Hono<Env>()

  // ---- basic rate limit for sign-in/registration (per server instance) ----
  const attempts = new Map<string, { count: number; reset: number }>()
  const rateLimit: MiddlewareHandler<Env> = async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local'
    const now = Date.now()
    const a = attempts.get(ip)
    if (!a || a.reset < now) attempts.set(ip, { count: 1, reset: now + 10 * 60_000 })
    else if (++a.count > authRateLimit) fail(429, 'Too many attempts. Try again in a few minutes.')
    await next()
  }

  const requireUser: MiddlewareHandler<Env> = async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1]
    const claims = token ? verifyToken(token, jwtSecret) : null
    if (!claims) fail(401, 'Please sign in again.')
    const [user] = await sql<{ id: string; username: string }>`SELECT id, username FROM users WHERE id = ${claims!.sub}`
    if (!user) fail(401, 'This account no longer exists.')
    c.set('userId', user.id)
    c.set('username', user.username)
    await next()
  }

  const session = (user: { id: string; username: string }) => ({
    token: signToken({ sub: user.id, username: user.username }, jwtSecret, tokenTtlSeconds),
    user: { id: user.id, username: user.username }
  })

  const areFriends = async (a: string, b: string): Promise<boolean> => {
    const rows = await sql`SELECT 1 FROM friendships WHERE status = 'accepted'
      AND ((requester_id = ${a} AND addressee_id = ${b}) OR (requester_id = ${b} AND addressee_id = ${a}))`
    return rows.length > 0
  }

  app.get('/', (c) => c.json({ name: 'vanity-api', ok: true }))

  // ---- accounts ------------------------------------------------------------

  app.post('/auth/register', rateLimit, async (c) => {
    const { username, password } = await body<{ username: string; password: string }>(c)
    if (typeof username !== 'string' || !USERNAME.test(username)) fail(400, 'Usernames are 3–20 letters, numbers or underscores.')
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) fail(400, 'Passwords need at least 8 characters.')
    const taken = await sql`SELECT 1 FROM users WHERE lower(username) = lower(${username})`
    if (taken.length) fail(409, 'That username is taken.')
    const hash = await hashPassword(password!)
    try {
      const [user] = await sql<{ id: string; username: string }>`INSERT INTO users (username, password_hash) VALUES (${username}, ${hash}) RETURNING id, username`
      return c.json(session(user), 201)
    } catch {
      // Lost a race with someone registering the same name.
      return fail(409, 'That username is taken.')
    }
  })

  app.post('/auth/login', rateLimit, async (c) => {
    const { username, password } = await body<{ username: string; password: string }>(c)
    if (typeof username !== 'string' || typeof password !== 'string') fail(400, 'Enter your username and password.')
    const [user] = await sql<{ id: string; username: string; password_hash: string }>`
      SELECT id, username, password_hash FROM users WHERE lower(username) = lower(${username})`
    // Same message either way, so usernames can't be probed.
    if (!user || !(await verifyPassword(password!, user.password_hash))) fail(401, 'Wrong username or password.')
    return c.json(session(user))
  })

  app.get('/me', requireUser, (c) => c.json({ user: { id: c.get('userId'), username: c.get('username') } }))

  app.delete('/me', requireUser, async (c) => {
    await sql`DELETE FROM users WHERE id = ${c.get('userId')}`
    return c.body(null, 204)
  })

  // ---- presence and stats --------------------------------------------------

  app.put('/presence', requireUser, async (c) => {
    const b = await body<{ gameKey: string | null; gameName: string | null; startedAt: number | null }>(c)
    const gameKey = typeof b.gameKey === 'string' ? b.gameKey.slice(0, 200) : null
    const gameName = gameKey && typeof b.gameName === 'string' ? b.gameName.slice(0, 200) : null
    const startedAt = gameKey && typeof b.startedAt === 'number' && Number.isFinite(b.startedAt) ? b.startedAt / 1000 : null
    await sql`INSERT INTO presence (user_id, game_key, game_name, started_at, signed_off, updated_at)
      VALUES (${c.get('userId')}, ${gameKey}, ${gameName}, CASE WHEN ${startedAt}::float8 IS NULL THEN NULL ELSE to_timestamp(${startedAt}::float8) END, false, now())
      ON CONFLICT (user_id) DO UPDATE SET game_key = excluded.game_key, game_name = excluded.game_name,
        started_at = excluded.started_at, signed_off = false, updated_at = now()`
    return c.body(null, 204)
  })

  app.delete('/presence', requireUser, async (c) => {
    await sql`UPDATE presence SET game_key = NULL, game_name = NULL, started_at = NULL, signed_off = true, updated_at = now() WHERE user_id = ${c.get('userId')}`
    return c.body(null, 204)
  })

  app.put('/stats', requireUser, async (c) => {
    const b = await body<{ games: { gameKey: string; gameName: string; playtimeSeconds: number; lastPlayedAt: number | null }[] }>(c)
    if (!Array.isArray(b.games)) fail(400, 'Expected { games: [...] }.')
    if (b.games!.length > MAX_STATS) fail(400, `At most ${MAX_STATS} games per sync.`)
    const byKey = new Map<string, { name: string; seconds: number; last: number | null }>()
    for (const g of b.games!) {
      if (!g || typeof g.gameKey !== 'string' || !g.gameKey || typeof g.gameName !== 'string') continue
      const seconds = Math.max(0, Math.min(1_000_000_000, Math.floor(Number(g.playtimeSeconds) || 0)))
      const last = typeof g.lastPlayedAt === 'number' && Number.isFinite(g.lastPlayedAt) ? g.lastPlayedAt / 1000 : null
      byKey.set(g.gameKey.slice(0, 200), { name: g.gameName.slice(0, 200), seconds, last })
    }
    if (byKey.size) {
      const keys = [...byKey.keys()]
      const names = keys.map((k) => byKey.get(k)!.name)
      const seconds = keys.map((k) => byKey.get(k)!.seconds)
      const lasts = keys.map((k) => byKey.get(k)!.last)
      await sql`INSERT INTO game_stats (user_id, game_key, game_name, playtime_seconds, last_played_at, updated_at)
        SELECT ${c.get('userId')}, t.k, t.n, t.p, CASE WHEN t.l IS NULL THEN NULL ELSE to_timestamp(t.l) END, now()
        FROM unnest(${keys}::text[], ${names}::text[], ${seconds}::int[], ${lasts}::float8[]) AS t(k, n, p, l)
        ON CONFLICT (user_id, game_key) DO UPDATE SET game_name = excluded.game_name,
          playtime_seconds = excluded.playtime_seconds, last_played_at = excluded.last_played_at, updated_at = now()`
    }
    return c.json({ synced: byKey.size })
  })

  // ---- friends -------------------------------------------------------------

  app.get('/friends', requireUser, async (c) => {
    const me = c.get('userId')
    const friends = await sql<{
      id: string
      username: string
      online: boolean
      game_name: string | null
      started_at: unknown
      updated_at: unknown
      total: number
      games: number
      top_game: string | null
    }>`
      SELECT u.id, u.username,
        COALESCE(NOT p.signed_off AND p.updated_at > now() - ${ONLINE_WINDOW}::interval, false) AS online,
        p.game_name, p.started_at, p.updated_at,
        COALESCE((SELECT SUM(playtime_seconds) FROM game_stats s WHERE s.user_id = u.id), 0)::int AS total,
        (SELECT COUNT(*) FROM game_stats s WHERE s.user_id = u.id AND s.playtime_seconds > 0)::int AS games,
        (SELECT game_name FROM game_stats s WHERE s.user_id = u.id ORDER BY playtime_seconds DESC LIMIT 1) AS top_game
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.requester_id = ${me} THEN f.addressee_id ELSE f.requester_id END
      LEFT JOIN presence p ON p.user_id = u.id
      WHERE f.status = 'accepted' AND (f.requester_id = ${me} OR f.addressee_id = ${me})
      ORDER BY lower(u.username)`
    const incoming = await sql<{ id: string; username: string; created_at: unknown }>`
      SELECT u.id, u.username, f.created_at FROM friendships f JOIN users u ON u.id = f.requester_id
      WHERE f.addressee_id = ${me} AND f.status = 'pending' ORDER BY f.created_at DESC`
    const outgoing = await sql<{ id: string; username: string; created_at: unknown }>`
      SELECT u.id, u.username, f.created_at FROM friendships f JOIN users u ON u.id = f.addressee_id
      WHERE f.requester_id = ${me} AND f.status = 'pending' ORDER BY f.created_at DESC`
    return c.json({
      friends: friends.map((f) => ({
        id: f.id,
        username: f.username,
        status: status(f),
        totalPlaytimeSeconds: f.total,
        gamesPlayed: f.games,
        topGame: f.top_game
      })),
      incoming: incoming.map((r) => ({ id: r.id, username: r.username, createdAt: toMs(r.created_at) })),
      outgoing: outgoing.map((r) => ({ id: r.id, username: r.username, createdAt: toMs(r.created_at) }))
    })
  })

  app.post('/friends/requests', requireUser, async (c) => {
    const me = c.get('userId')
    const { username } = await body<{ username: string }>(c)
    if (typeof username !== 'string' || !username.trim()) fail(400, 'Enter a username.')
    const [target] = await sql<{ id: string; username: string }>`SELECT id, username FROM users WHERE lower(username) = lower(${username!.trim()})`
    if (!target) fail(404, `No one is called "${username!.trim()}".`)
    if (target.id === me) fail(400, "That's you!")
    const [existing] = await sql<{ requester_id: string; status: string }>`SELECT requester_id, status FROM friendships
      WHERE (requester_id = ${me} AND addressee_id = ${target.id}) OR (requester_id = ${target.id} AND addressee_id = ${me})`
    if (existing?.status === 'accepted') fail(409, `You're already friends with ${target.username}.`)
    if (existing && existing.requester_id === target.id) {
      // They already asked us: accept.
      await sql`UPDATE friendships SET status = 'accepted' WHERE requester_id = ${target.id} AND addressee_id = ${me}`
      return c.json({ status: 'accepted', user: target })
    }
    if (!existing) await sql`INSERT INTO friendships (requester_id, addressee_id, status) VALUES (${me}, ${target.id}, 'pending')`
    return c.json({ status: 'pending', user: target }, existing ? 200 : 201)
  })

  app.post('/friends/requests/:id/accept', requireUser, async (c) => {
    const rows = await sql`UPDATE friendships SET status = 'accepted'
      WHERE requester_id = ${c.req.param('id')} AND addressee_id = ${c.get('userId')} AND status = 'pending' RETURNING 1`
    if (!rows.length) fail(404, 'That request is no longer there.')
    return c.json({ status: 'accepted' })
  })

  /** Declines an incoming request or cancels an outgoing one. */
  app.delete('/friends/requests/:id', requireUser, async (c) => {
    const me = c.get('userId')
    const other = c.req.param('id')
    await sql`DELETE FROM friendships WHERE status = 'pending'
      AND ((requester_id = ${other} AND addressee_id = ${me}) OR (requester_id = ${me} AND addressee_id = ${other}))`
    return c.body(null, 204)
  })

  app.delete('/friends/:id', requireUser, async (c) => {
    const me = c.get('userId')
    const other = c.req.param('id')
    await sql`DELETE FROM friendships WHERE status = 'accepted'
      AND ((requester_id = ${other} AND addressee_id = ${me}) OR (requester_id = ${me} AND addressee_id = ${other}))`
    return c.body(null, 204)
  })

  app.get('/friends/:id/stats', requireUser, async (c) => {
    const id = c.req.param('id')
    if (!(await areFriends(c.get('userId'), id))) fail(403, 'You can only see stats of your friends.')
    const [user] = await sql<{ username: string }>`SELECT username FROM users WHERE id = ${id}`
    const games = await sql<{ game_key: string; game_name: string; playtime_seconds: number; last_played_at: unknown }>`
      SELECT game_key, game_name, playtime_seconds, last_played_at FROM game_stats
      WHERE user_id = ${id} AND playtime_seconds > 0 ORDER BY playtime_seconds DESC`
    const shape = (g: (typeof games)[number]) => ({ gameKey: g.game_key, gameName: g.game_name, playtimeSeconds: g.playtime_seconds, lastPlayedAt: toMs(g.last_played_at) })
    return c.json({
      username: user?.username ?? '',
      totalPlaytimeSeconds: games.reduce((sum, g) => sum + g.playtime_seconds, 0),
      gamesPlayed: games.length,
      top: games.slice(0, 10).map(shape),
      recent: [...games]
        .filter((g) => g.last_played_at)
        .sort((a, b) => (toMs(b.last_played_at) ?? 0) - (toMs(a.last_played_at) ?? 0))
        .slice(0, 5)
        .map(shape)
    })
  })

  /** Friends who have played a game (by Vanity's game key). */
  app.get('/games/:key/friends', requireUser, async (c) => {
    const me = c.get('userId')
    const rows = await sql<{ id: string; username: string; playtime_seconds: number; last_played_at: unknown }>`
      SELECT u.id, u.username, s.playtime_seconds, s.last_played_at
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.requester_id = ${me} THEN f.addressee_id ELSE f.requester_id END
      JOIN game_stats s ON s.user_id = u.id AND s.game_key = ${c.req.param('key')} AND s.playtime_seconds > 0
      WHERE f.status = 'accepted' AND (f.requester_id = ${me} OR f.addressee_id = ${me})
      ORDER BY s.playtime_seconds DESC`
    return c.json({
      friends: rows.map((r) => ({ id: r.id, username: r.username, playtimeSeconds: r.playtime_seconds, lastPlayedAt: toMs(r.last_played_at) }))
    })
  })

  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error('[vanity-api]', err)
    return c.json({ error: 'Something went wrong on the server.' }, 500)
  })

  // Serve every route at /… and at /api/…, so the server works on its own domain
  // or behind a site that forwards /api/* to it (e.g. Vercel services).
  const root = new Hono<Env>()
  root.route('/api', app)
  root.route('/', app)
  return root
}
