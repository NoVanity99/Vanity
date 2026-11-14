import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { VerifyToken } from './auth'
import type { Sql } from './db'
import { keyMatches, type UpdateBundle } from './updates'

export interface AppOptions {
  sql: Sql
  /** Checks a Neon Auth session token (see auth.ts). */
  verifyToken: VerifyToken
  /** Creates the tables if they are missing. Run once, before the first request that needs the database. */
  migrate?: () => Promise<void>
  /** Max username look-ups per IP per 10 minutes. */
  lookupRateLimit?: number
  /** The Vanity app update bundle built into this deployment, if any. */
  updates?: () => Promise<UpdateBundle | null>
  /** When set, /update needs this in the X-Update-Key header. */
  updateKey?: string
}

type Env = { Variables: { userId: string; username: string; email: string | null } }

const USERNAME = /^[A-Za-z0-9_]{3,20}$/
const ONLINE_WINDOW = '3 minutes'
const MAX_STATS = 5000

const fail = (status: 400 | 401 | 403 | 404 | 409 | 429, message: string, code?: string): never => {
  throw new HTTPException(status, { message, cause: code })
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

export function createApp({ sql, verifyToken, migrate, lookupRateLimit = 60, updates, updateKey }: AppOptions): Hono<Env> {
  const app = new Hono<Env>()

  // The tables are created on first use, so a fresh Neon database needs no manual setup.
  let migrated: Promise<void> | null = null
  const ready = async (): Promise<void> => {
    if (!migrate) return
    migrated ??= migrate().catch((err) => {
      migrated = null
      throw err
    })
    await migrated
  }

  // ---- basic rate limit for the public username check (per server instance) ----
  const attempts = new Map<string, { count: number; reset: number }>()
  const rateLimit: MiddlewareHandler<Env> = async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local'
    const now = Date.now()
    const a = attempts.get(ip)
    if (!a || a.reset < now) attempts.set(ip, { count: 1, reset: now + 10 * 60_000 })
    else if (++a.count > lookupRateLimit) fail(429, 'Too many attempts. Try again in a few minutes.')
    await next()
  }

  /** A valid Neon Auth session. The account may not have picked a username yet. */
  const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1]
    const user = token ? await verifyToken(token) : null
    if (!user) fail(401, 'Please sign in again.')
    await ready()
    c.set('userId', user!.id)
    c.set('email', user!.email)
    await next()
  }

  /** A valid session whose account has a username (everything social needs one). */
  const requireUser: MiddlewareHandler<Env> = async (c, next) => {
    const [profile] = await sql<{ username: string }>`SELECT username FROM vanity.profiles WHERE id = ${c.get('userId')}`
    if (!profile) fail(409, 'Choose a username to finish setting up your account.', 'needs_username')
    c.set('username', profile.username)
    await next()
  }

  const areFriends = async (a: string, b: string): Promise<boolean> => {
    const rows = await sql`SELECT 1 FROM vanity.friendships WHERE status = 'accepted'
      AND ((requester_id = ${a} AND addressee_id = ${b}) OR (requester_id = ${b} AND addressee_id = ${a}))`
    return rows.length > 0
  }

  app.get('/', (c) => c.json({ name: 'vanity-api', ok: true, auth: 'neon' }))

  // ---- app updates (the desktop app checks these every minute) ----
  const updateBundle = async (c: Context): Promise<UpdateBundle> => {
    if (updateKey && !keyMatches(c.req.header('x-update-key'), updateKey)) fail(401, 'This update key is wrong.')
    const bundle = updates ? await updates() : null
    if (!bundle) fail(404, 'This server has no update bundle. Redeploy it on Vercel to build one.')
    return bundle!
  }
  app.get('/update', async (c) => {
    const b = await updateBundle(c)
    c.header('Cache-Control', 'no-store')
    return c.json({ version: b.version, changelog: b.changelog, sha: b.sha, builtAt: b.builtAt, size: b.size })
  })
  app.get('/update/download', async (c) => {
    const b = await updateBundle(c)
    return new Response(Buffer.from(b.zipBase64, 'base64'), {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="vanity-${b.version}.zip"`, 'Cache-Control': 'no-store' }
    })
  })

  // ---- accounts ------------------------------------------------------------

  /** Whether a username is free. Public, so the sign-up form can check before the account is created. */
  app.get('/usernames/:name', rateLimit, async (c) => {
    const name = c.req.param('name')
    if (!USERNAME.test(name)) fail(400, 'Usernames are 3–20 letters, numbers or underscores.')
    await ready()
    const taken = await sql`SELECT 1 FROM vanity.profiles WHERE lower(username) = lower(${name})`
    return c.json({ available: taken.length === 0 })
  })

  app.get('/me', requireAuth, async (c) => {
    const [profile] = await sql<{ username: string }>`SELECT username FROM vanity.profiles WHERE id = ${c.get('userId')}`
    return c.json({ user: { id: c.get('userId'), email: c.get('email'), username: profile?.username ?? null } })
  })

  /** Picks the username for a new account, or renames an existing one. */
  app.put('/me/username', requireAuth, async (c) => {
    const { username } = await body<{ username: string }>(c)
    if (typeof username !== 'string' || !USERNAME.test(username)) fail(400, 'Usernames are 3–20 letters, numbers or underscores.')
    const me = c.get('userId')
    const taken = await sql`SELECT 1 FROM vanity.profiles WHERE lower(username) = lower(${username}) AND id <> ${me}`
    if (taken.length) fail(409, 'That username is taken.')
    try {
      await sql`INSERT INTO vanity.profiles (id, username) VALUES (${me}, ${username})
        ON CONFLICT (id) DO UPDATE SET username = excluded.username`
    } catch {
      // Lost a race with someone picking the same name.
      fail(409, 'That username is taken.')
    }
    return c.json({ user: { id: me, email: c.get('email'), username } })
  })

  /** Removes everything Vanity stores about the account (profile, friends, presence, stats). */
  app.delete('/me', requireAuth, async (c) => {
    await sql`DELETE FROM vanity.profiles WHERE id = ${c.get('userId')}`
    return c.body(null, 204)
  })

  // ---- presence and stats --------------------------------------------------

  app.put('/presence', requireAuth, requireUser, async (c) => {
    const b = await body<{ gameKey: string | null; gameName: string | null; startedAt: number | null }>(c)
    const gameKey = typeof b.gameKey === 'string' ? b.gameKey.slice(0, 200) : null
    const gameName = gameKey && typeof b.gameName === 'string' ? b.gameName.slice(0, 200) : null
    const startedAt = gameKey && typeof b.startedAt === 'number' && Number.isFinite(b.startedAt) ? b.startedAt / 1000 : null
    await sql`INSERT INTO vanity.presence (user_id, game_key, game_name, started_at, signed_off, updated_at)
      VALUES (${c.get('userId')}, ${gameKey}, ${gameName}, CASE WHEN ${startedAt}::float8 IS NULL THEN NULL ELSE to_timestamp(${startedAt}::float8) END, false, now())
      ON CONFLICT (user_id) DO UPDATE SET game_key = excluded.game_key, game_name = excluded.game_name,
        started_at = excluded.started_at, signed_off = false, updated_at = now()`
    return c.body(null, 204)
  })

  app.delete('/presence', requireAuth, requireUser, async (c) => {
    await sql`UPDATE vanity.presence SET game_key = NULL, game_name = NULL, started_at = NULL, signed_off = true, updated_at = now() WHERE user_id = ${c.get('userId')}`
    return c.body(null, 204)
  })

  app.put('/stats', requireAuth, requireUser, async (c) => {
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
      await sql`INSERT INTO vanity.game_stats (user_id, game_key, game_name, playtime_seconds, last_played_at, updated_at)
        SELECT ${c.get('userId')}, t.k, t.n, t.p, CASE WHEN t.l IS NULL THEN NULL ELSE to_timestamp(t.l) END, now()
        FROM unnest(${keys}::text[], ${names}::text[], ${seconds}::int[], ${lasts}::float8[]) AS t(k, n, p, l)
        ON CONFLICT (user_id, game_key) DO UPDATE SET game_name = excluded.game_name,
          playtime_seconds = excluded.playtime_seconds, last_played_at = excluded.last_played_at, updated_at = now()`
    }
    return c.json({ synced: byKey.size })
  })

  // ---- friends -------------------------------------------------------------

  app.get('/friends', requireAuth, requireUser, async (c) => {
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
        COALESCE((SELECT SUM(playtime_seconds) FROM vanity.game_stats s WHERE s.user_id = u.id), 0)::int AS total,
        (SELECT COUNT(*) FROM vanity.game_stats s WHERE s.user_id = u.id AND s.playtime_seconds > 0)::int AS games,
        (SELECT game_name FROM vanity.game_stats s WHERE s.user_id = u.id ORDER BY playtime_seconds DESC LIMIT 1) AS top_game
      FROM vanity.friendships f
      JOIN vanity.profiles u ON u.id = CASE WHEN f.requester_id = ${me} THEN f.addressee_id ELSE f.requester_id END
      LEFT JOIN vanity.presence p ON p.user_id = u.id
      WHERE f.status = 'accepted' AND (f.requester_id = ${me} OR f.addressee_id = ${me})
      ORDER BY lower(u.username)`
    const incoming = await sql<{ id: string; username: string; created_at: unknown }>`
      SELECT u.id, u.username, f.created_at FROM vanity.friendships f JOIN vanity.profiles u ON u.id = f.requester_id
      WHERE f.addressee_id = ${me} AND f.status = 'pending' ORDER BY f.created_at DESC`
    const outgoing = await sql<{ id: string; username: string; created_at: unknown }>`
      SELECT u.id, u.username, f.created_at FROM vanity.friendships f JOIN vanity.profiles u ON u.id = f.addressee_id
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

  app.post('/friends/requests', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const { username } = await body<{ username: string }>(c)
    if (typeof username !== 'string' || !username.trim()) fail(400, 'Enter a username.')
    const [target] = await sql<{ id: string; username: string }>`SELECT id, username FROM vanity.profiles WHERE lower(username) = lower(${username!.trim()})`
    if (!target) fail(404, `No one is called "${username!.trim()}".`)
    if (target.id === me) fail(400, "That's you!")
    const [existing] = await sql<{ requester_id: string; status: string }>`SELECT requester_id, status FROM vanity.friendships
      WHERE (requester_id = ${me} AND addressee_id = ${target.id}) OR (requester_id = ${target.id} AND addressee_id = ${me})`
    if (existing?.status === 'accepted') fail(409, `You're already friends with ${target.username}.`)
    if (existing && existing.requester_id === target.id) {
      // They already asked us: accept.
      await sql`UPDATE vanity.friendships SET status = 'accepted' WHERE requester_id = ${target.id} AND addressee_id = ${me}`
      return c.json({ status: 'accepted', user: target })
    }
    if (!existing) await sql`INSERT INTO vanity.friendships (requester_id, addressee_id, status) VALUES (${me}, ${target.id}, 'pending')`
    return c.json({ status: 'pending', user: target }, existing ? 200 : 201)
  })

  app.post('/friends/requests/:id/accept', requireAuth, requireUser, async (c) => {
    const rows = await sql`UPDATE vanity.friendships SET status = 'accepted'
      WHERE requester_id = ${c.req.param('id')} AND addressee_id = ${c.get('userId')} AND status = 'pending' RETURNING 1`
    if (!rows.length) fail(404, 'That request is no longer there.')
    return c.json({ status: 'accepted' })
  })

  /** Declines an incoming request or cancels an outgoing one. */
  app.delete('/friends/requests/:id', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const other = c.req.param('id')
    await sql`DELETE FROM vanity.friendships WHERE status = 'pending'
      AND ((requester_id = ${other} AND addressee_id = ${me}) OR (requester_id = ${me} AND addressee_id = ${other}))`
    return c.body(null, 204)
  })

  app.delete('/friends/:id', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const other = c.req.param('id')
    await sql`DELETE FROM vanity.friendships WHERE status = 'accepted'
      AND ((requester_id = ${other} AND addressee_id = ${me}) OR (requester_id = ${me} AND addressee_id = ${other}))`
    return c.body(null, 204)
  })

  app.get('/friends/:id/stats', requireAuth, requireUser, async (c) => {
    const id = c.req.param('id')
    if (!(await areFriends(c.get('userId'), id))) fail(403, 'You can only see stats of your friends.')
    const [user] = await sql<{ username: string }>`SELECT username FROM vanity.profiles WHERE id = ${id}`
    const games = await sql<{ game_key: string; game_name: string; playtime_seconds: number; last_played_at: unknown }>`
      SELECT game_key, game_name, playtime_seconds, last_played_at FROM vanity.game_stats
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
  app.get('/games/:key/friends', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const rows = await sql<{ id: string; username: string; playtime_seconds: number; last_played_at: unknown }>`
      SELECT u.id, u.username, s.playtime_seconds, s.last_played_at
      FROM vanity.friendships f
      JOIN vanity.profiles u ON u.id = CASE WHEN f.requester_id = ${me} THEN f.addressee_id ELSE f.requester_id END
      JOIN vanity.game_stats s ON s.user_id = u.id AND s.game_key = ${c.req.param('key')} AND s.playtime_seconds > 0
      WHERE f.status = 'accepted' AND (f.requester_id = ${me} OR f.addressee_id = ${me})
      ORDER BY s.playtime_seconds DESC`
    return c.json({
      friends: rows.map((r) => ({ id: r.id, username: r.username, playtimeSeconds: r.playtime_seconds, lastPlayedAt: toMs(r.last_played_at) }))
    })
  })

  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message, ...(typeof err.cause === 'string' ? { code: err.cause } : {}) }, err.status)
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
