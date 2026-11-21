import { Hono, type MiddlewareHandler } from 'hono'
import { body, fail, toMs, type Env, type PublicUserFn } from './app'
import type { LedgerKind } from './coins'
import type { Sql } from './db'
import type { People } from './people'
import { DEFAULT_STYLE } from './profileStyle'

// What Vanity's admins can do (Settings → Admin in the app). Every route needs the admin badge,
// which is checked here on the server; the app hiding the tab is not what protects it.
// Everything that changes something is written to the admin log.

interface AdminDeps {
  sql: Sql
  requireAuth: MiddlewareHandler<Env>
  requireUser: MiddlewareHandler<Env>
  requireAdmin: MiddlewareHandler<Env>
  people: People
  publicUser: PublicUserFn
  emailOf(id: string): Promise<string | null>
  /** Adds (or takes) coins through the ledger. */
  grant(userId: string, amount: number, kind: LedgerKind, ref: string, note?: string): Promise<number | null>
  now: () => number
  logAdmin(adminId: string, action: string, targetId: string | null, detail?: string): Promise<void>
}

const USERNAME = /^[A-Za-z0-9_]{3,20}$/
const PAGE = 30
/** The longest time-out: 30 days. */
const MAX_TIMEOUT_MIN = 30 * 24 * 60
const MAX_COINS = 1_000_000

type UserRow = { id: string; username: string; avatar: string | null; style: unknown; created_at: unknown; last_seen: unknown; online: boolean; game_name: string | null; balance: number | null; level: number | null }

export function adminRoutes({ sql, requireAuth, requireUser, requireAdmin, people, publicUser, emailOf, grant, now, logAdmin }: AdminDeps): Hono<Env> {
  const app = new Hono<Env>()
  app.use('*', requireAuth, requireUser, requireAdmin)

  const emails = async (ids: string[]): Promise<Map<string, string>> => {
    try {
      const rows = ids.length ? await sql<{ id: string; email: string }>`SELECT id::text AS id, email FROM neon_auth."user" WHERE id::text = ANY(${ids}::text[])` : []
      return new Map(rows.map((r) => [r.id, r.email]))
    } catch {
      // Neon Auth's table can't be read from here: emails are left out.
      return new Map()
    }
  }
  const shape = (r: UserRow, email: string | null) => ({
    ...publicUser(r),
    email,
    createdAt: toMs(r.created_at),
    lastSeen: toMs(r.last_seen),
    online: r.online,
    playing: r.online ? r.game_name : null,
    coins: r.balance ?? 0,
    level: r.level ?? 1,
    standing: people.standingOf(r.id)
  })
  const target = async (id: string): Promise<{ id: string; username: string }> => {
    const [p] = await sql<{ id: string; username: string }>`SELECT id, username FROM vanity.profiles WHERE id = ${id}`
    if (!p) fail(404, 'That account no longer exists.')
    return p!
  }
  const after = async (): Promise<void> => {
    people.changed()
    await people.fresh()
  }

  /** The service at a glance. */
  app.get('/overview', async (c) => {
    const [n] = await sql<{ users: number; online: number; new_week: number; in_voice: number; banned: number; comments: number; reports: number; sold: number; revenue: number; outstanding: number }>`
      SELECT (SELECT COUNT(*) FROM vanity.profiles)::int AS users,
        (SELECT COUNT(*) FROM vanity.presence WHERE NOT signed_off AND updated_at > now() - interval '3 minutes')::int AS online,
        (SELECT COUNT(*) FROM vanity.profiles WHERE created_at > now() - interval '7 days')::int AS new_week,
        (SELECT COUNT(*) FROM vanity.voice_members WHERE last_seen > now() - interval '45 seconds')::int AS in_voice,
        (SELECT COUNT(*) FROM vanity.moderation WHERE banned)::int AS banned,
        (SELECT COUNT(*) FROM vanity.game_comments)::int AS comments,
        (SELECT COUNT(DISTINCT comment_id) FROM vanity.comment_reports WHERE resolved_at IS NULL)::int AS reports,
        (SELECT COALESCE(SUM(amount), 0) FROM vanity.coin_ledger WHERE kind = 'purchase')::int AS sold,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM vanity.coin_orders WHERE status = 'paid')::int AS revenue,
        (SELECT COALESCE(SUM(balance), 0) FROM vanity.coin_wallets)::int AS outstanding`
    return c.json({ ...n, unclaimedBadgeNames: await people.unclaimedNames() })
  })

  /** Every account, newest first, or those matching a search (start of a username, part of an email, or an id). */
  app.get('/users', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 100).toLowerCase()
    const page = Math.max(0, Math.min(10_000, Math.trunc(Number(c.req.query('page')) || 0)))
    const filter = c.req.query('filter') ?? ''
    let ids: string[] | null = null
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
      const byName = await sql<{ id: string }>`SELECT id FROM vanity.profiles WHERE lower(username) LIKE ${like} OR id = ${q} LIMIT 200`
      let byEmail: { id: string }[] = []
      try {
        byEmail = await sql<{ id: string }>`SELECT id::text AS id FROM neon_auth."user" WHERE lower(email) LIKE ${like} LIMIT 200`
      } catch {
        // Emails can't be searched from here.
      }
      const old = await sql<{ id: string }>`SELECT DISTINCT user_id AS id FROM vanity.username_history WHERE lower(old_username) LIKE ${like} LIMIT 100`
      ids = [...new Set([...byName, ...byEmail, ...old].map((r) => r.id))]
    }
    const rows = await sql<UserRow & { total: number }>`
      SELECT p.id, p.username, p.avatar, p.style, p.created_at, pr.updated_at AS last_seen,
        COALESCE(NOT pr.signed_off AND pr.updated_at > now() - interval '3 minutes', false) AS online, pr.game_name,
        w.balance, us.level, COUNT(*) OVER ()::int AS total
      FROM vanity.profiles p
      LEFT JOIN vanity.presence pr ON pr.user_id = p.id
      LEFT JOIN vanity.coin_wallets w ON w.user_id = p.id
      LEFT JOIN vanity.user_state us ON us.user_id = p.id
      LEFT JOIN vanity.moderation m ON m.user_id = p.id
      LEFT JOIN vanity.roles ro ON ro.user_id = p.id
      WHERE (${ids}::text[] IS NULL OR p.id = ANY(${ids}::text[]))
        AND (${filter} <> 'banned' OR m.banned)
        AND (${filter} <> 'timedout' OR m.timeout_until > now())
        AND (${filter} <> 'staff' OR ro.admin OR ro.verified)
        AND (${filter} <> 'online' OR (NOT pr.signed_off AND pr.updated_at > now() - interval '3 minutes'))
      ORDER BY p.created_at DESC, p.id LIMIT ${PAGE} OFFSET ${page * PAGE}`
    const mail = await emails(rows.map((r) => r.id))
    return c.json({ users: rows.map((r) => shape(r, mail.get(r.id) ?? null)), total: rows[0]?.total ?? 0, page, pageSize: PAGE })
  })

  /** One account in full. */
  app.get('/users/:id', async (c) => {
    const id = c.req.param('id')
    const [r] = await sql<UserRow & { bio: string }>`
      SELECT p.id, p.username, p.avatar, p.style, p.bio, p.created_at, pr.updated_at AS last_seen,
        COALESCE(NOT pr.signed_off AND pr.updated_at > now() - interval '3 minutes', false) AS online, pr.game_name, w.balance, us.level
      FROM vanity.profiles p LEFT JOIN vanity.presence pr ON pr.user_id = p.id LEFT JOIN vanity.coin_wallets w ON w.user_id = p.id LEFT JOIN vanity.user_state us ON us.user_id = p.id
      WHERE p.id = ${id}`
    if (!r) fail(404, 'That account no longer exists.')
    const names = await sql<{ old_username: string | null; new_username: string; by_admin: boolean; changed_at: unknown }>`SELECT old_username, new_username, by_admin, changed_at FROM vanity.username_history WHERE user_id = ${id} ORDER BY changed_at DESC LIMIT 30`
    const ledger = await sql<{ id: string | number; kind: string; amount: number; note: string; created_at: unknown }>`SELECT id, kind, amount, note, created_at FROM vanity.coin_ledger WHERE user_id = ${id} ORDER BY id DESC LIMIT 30`
    const [n] = await sql<{ friends: number; comments: number; reports: number; messages: number; spent: number; bought: number }>`
      SELECT (SELECT COUNT(*) FROM vanity.friendships WHERE status = 'accepted' AND (requester_id = ${id} OR addressee_id = ${id}))::int AS friends,
        (SELECT COUNT(*) FROM vanity.game_comments WHERE user_id = ${id})::int AS comments,
        (SELECT COUNT(*) FROM vanity.comment_reports cr JOIN vanity.game_comments gc ON gc.id = cr.comment_id WHERE gc.user_id = ${id})::int AS reports,
        (SELECT COUNT(*) FROM vanity.messages WHERE sender_id = ${id})::int AS messages,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM vanity.coin_orders WHERE user_id = ${id} AND status = 'paid')::int AS spent,
        (SELECT COALESCE(SUM(amount), 0) FROM vanity.coin_ledger WHERE user_id = ${id} AND kind = 'purchase')::int AS bought`
    const [steam] = await sql<{ display_name: string; profile_url: string }>`SELECT display_name, profile_url FROM vanity.linked_accounts WHERE user_id = ${id} AND provider = 'steam'`
    const owned = await sql<{ item_id: string }>`SELECT item_id FROM vanity.shop_owned WHERE user_id = ${id}`
    const log = await sql<{ action: string; detail: string; created_at: unknown; admin: string | null }>`SELECT l.action, l.detail, l.created_at, a.username AS admin FROM vanity.admin_log l LEFT JOIN vanity.profiles a ON a.id = l.admin_id WHERE l.target_id = ${id} ORDER BY l.id DESC LIMIT 20`
    return c.json({
      user: { ...shape(r!, await emailOf(id)), bio: r!.bio },
      counts: n,
      steam: steam ? { name: steam.display_name, profileUrl: steam.profile_url } : null,
      owned: owned.map((o) => o.item_id),
      usernames: names.map((h) => ({ from: h.old_username, to: h.new_username, byAdmin: h.by_admin, at: toMs(h.changed_at) })),
      ledger: ledger.map((l) => ({ id: Number(l.id), kind: l.kind, amount: l.amount, note: l.note, at: toMs(l.created_at) })),
      log: log.map((l) => ({ action: l.action, detail: l.detail, admin: l.admin, at: toMs(l.created_at) }))
    })
  })

  app.post('/users/:id/ban', async (c) => {
    const me = c.get('userId')
    const t = await target(c.req.param('id'))
    if (t.id === me) fail(400, "You can't ban yourself.")
    if (people.rolesOf(t.id).admin) fail(400, 'Take their admin badge away first.')
    const reason = String((await body<{ reason: string }>(c)).reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    await sql`INSERT INTO vanity.moderation (user_id, banned, reason, updated_at) VALUES (${t.id}, true, ${reason}, now())
      ON CONFLICT (user_id) DO UPDATE SET banned = true, reason = excluded.reason, updated_at = now()`
    // Out of any call, and shown as offline, straight away.
    await sql`DELETE FROM vanity.voice_members WHERE user_id = ${t.id}`
    await sql`UPDATE vanity.presence SET signed_off = true, game_key = NULL, game_name = NULL WHERE user_id = ${t.id}`
    await logAdmin(me, 'ban', t.id, reason)
    await after()
    return c.body(null, 204)
  })

  app.post('/users/:id/unban', async (c) => {
    const t = await target(c.req.param('id'))
    await sql`UPDATE vanity.moderation SET banned = false, reason = '', updated_at = now() WHERE user_id = ${t.id}`
    await logAdmin(c.get('userId'), 'unban', t.id)
    await after()
    return c.body(null, 204)
  })

  /** `minutes` 0 ends a time-out. While timed out they can't message, comment or use voice. */
  app.post('/users/:id/timeout', async (c) => {
    const me = c.get('userId')
    const t = await target(c.req.param('id'))
    const minutes = Math.trunc(Number((await body<{ minutes: number }>(c)).minutes))
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_TIMEOUT_MIN) fail(400, 'A time-out can be up to 30 days.')
    if (minutes > 0 && t.id === me) fail(400, "You can't time yourself out.")
    if (minutes > 0 && people.rolesOf(t.id).admin) fail(400, 'Take their admin badge away first.')
    const until = minutes > 0 ? (now() + minutes * 60_000) / 1000 : null
    await sql`INSERT INTO vanity.moderation (user_id, timeout_until, updated_at) VALUES (${t.id}, CASE WHEN ${until}::float8 IS NULL THEN NULL ELSE to_timestamp(${until}::float8) END, now())
      ON CONFLICT (user_id) DO UPDATE SET timeout_until = excluded.timeout_until, updated_at = now()`
    if (minutes > 0) await sql`DELETE FROM vanity.voice_members WHERE user_id = ${t.id}`
    await logAdmin(me, minutes > 0 ? 'timeout' : 'end timeout', t.id, minutes > 0 ? `${minutes} minutes` : '')
    await after()
    return c.body(null, 204)
  })

  /** Gives or takes the verified check and the admin crown. */
  app.post('/users/:id/roles', async (c) => {
    const me = c.get('userId')
    const t = await target(c.req.param('id'))
    const b = await body<{ verified: boolean; admin: boolean }>(c)
    const current = people.rolesOf(t.id)
    const next = { verified: typeof b.verified === 'boolean' ? b.verified : current.verified, admin: typeof b.admin === 'boolean' ? b.admin : current.admin }
    if (t.id === me && current.admin && !next.admin) fail(400, "You can't take your own admin badge away. Ask another admin.")
    await sql`INSERT INTO vanity.roles (user_id, verified, admin) VALUES (${t.id}, ${next.verified}, ${next.admin})
      ON CONFLICT (user_id) DO UPDATE SET verified = excluded.verified, admin = excluded.admin`
    await logAdmin(me, 'badges', t.id, `verified: ${next.verified}, admin: ${next.admin}`)
    await after()
    return c.json(next)
  })

  /** Adds coins (or, with a negative amount, takes them) as an "admin" row in the ledger. Usable at once. */
  app.post('/users/:id/coins', async (c) => {
    const me = c.get('userId')
    const t = await target(c.req.param('id'))
    const b = await body<{ amount: number; note: string }>(c)
    const amount = Math.trunc(Number(b.amount))
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_COINS) fail(400, `Enter a number of coins between 1 and ${MAX_COINS.toLocaleString('en-US')} (or negative to take coins away).`)
    const note = String(b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const [admin] = await sql<{ username: string }>`SELECT username FROM vanity.profiles WHERE id = ${me}`
    const balance = await grant(t.id, amount, 'admin', `${me}:${now()}:${Math.random().toString(36).slice(2, 10)}`, note || `${amount > 0 ? 'Added' : 'Removed'} by ${admin?.username ?? 'an admin'}`)
    await logAdmin(me, 'coins', t.id, `${amount > 0 ? '+' : ''}${amount}${note ? `: ${note}` : ''}`)
    return c.json({ balance })
  })

  /** Clears the picture, bio and look (for a profile that breaks the rules). */
  app.post('/users/:id/reset-profile', async (c) => {
    const t = await target(c.req.param('id'))
    await sql`UPDATE vanity.profiles SET avatar = NULL, bio = '', style = ${JSON.stringify(DEFAULT_STYLE)} WHERE id = ${t.id}`
    await logAdmin(c.get('userId'), 'reset profile', t.id)
    return c.body(null, 204)
  })

  /** Renames an account (for a name that breaks the rules). Doesn't count towards their own 30 days. */
  app.post('/users/:id/username', async (c) => {
    const t = await target(c.req.param('id'))
    const username = String((await body<{ username: string }>(c)).username ?? '').trim()
    if (!USERNAME.test(username)) fail(400, 'Usernames are 3–20 letters, numbers or underscores.')
    const taken = await sql`SELECT 1 FROM vanity.profiles WHERE lower(username) = lower(${username}) AND id <> ${t.id}`
    if (taken.length) fail(409, 'That username is already in use.')
    await sql`UPDATE vanity.profiles SET username = ${username} WHERE id = ${t.id}`
    await sql`INSERT INTO vanity.username_history (user_id, old_username, new_username, by_admin, changed_at) VALUES (${t.id}, ${t.username}, ${username}, true, to_timestamp(${now() / 1000}))`
    await logAdmin(c.get('userId'), 'rename', t.id, `${t.username} → ${username}`)
    return c.body(null, 204)
  })

  /** Lets them change their username again now, instead of waiting out the 30 days. */
  app.post('/users/:id/clear-cooldown', async (c) => {
    const t = await target(c.req.param('id'))
    await sql`UPDATE vanity.username_history SET by_admin = true WHERE user_id = ${t.id}`
    await logAdmin(c.get('userId'), 'clear username wait', t.id)
    return c.body(null, 204)
  })

  /** Removes every comment an account wrote. */
  app.post('/users/:id/delete-comments', async (c) => {
    const t = await target(c.req.param('id'))
    const gone = await sql`DELETE FROM vanity.game_comments WHERE user_id = ${t.id} RETURNING id`
    await logAdmin(c.get('userId'), 'delete comments', t.id, `${gone.length} removed`)
    return c.json({ removed: gone.length })
  })

  /** Takes them out of the voice room they're in. */
  app.post('/users/:id/kick-voice', async (c) => {
    const t = await target(c.req.param('id'))
    await sql`DELETE FROM vanity.voice_members WHERE user_id = ${t.id}`
    await logAdmin(c.get('userId'), 'kick from voice', t.id)
    return c.body(null, 204)
  })

  /** Deletes the Vanity profile with its friends, messages, stats and comments. The coin record is kept. */
  app.delete('/users/:id', async (c) => {
    const me = c.get('userId')
    const t = await target(c.req.param('id'))
    if (t.id === me) fail(400, 'Delete your own account from the Account page.')
    if (people.rolesOf(t.id).admin) fail(400, 'Take their admin badge away first.')
    await sql`DELETE FROM vanity.profiles WHERE id = ${t.id}`
    await logAdmin(me, 'delete account', t.id, t.username)
    await after()
    return c.body(null, 204)
  })

  /** Reported comments that nobody has dealt with yet, most reported first. */
  app.get('/reports', async (c) => {
    const rows = await sql<{ id: string | number; game_key: string; body: string; created_at: unknown; user_id: string; username: string; avatar: string | null; style: unknown; reports: number; reasons: string[] | string; first_at: unknown }>`
      SELECT gc.id, gc.game_key, gc.body, gc.created_at, gc.user_id, p.username, p.avatar, p.style,
        COUNT(*)::int AS reports, array_remove(array_agg(DISTINCT NULLIF(cr.reason, '')), NULL) AS reasons, MIN(cr.created_at) AS first_at
      FROM vanity.comment_reports cr JOIN vanity.game_comments gc ON gc.id = cr.comment_id JOIN vanity.profiles p ON p.id = gc.user_id
      WHERE cr.resolved_at IS NULL GROUP BY gc.id, p.id ORDER BY COUNT(*) DESC, MIN(cr.created_at) LIMIT 100`
    return c.json({
      reports: rows.map((r) => ({
        commentId: Number(r.id),
        gameKey: r.game_key,
        text: r.body,
        at: toMs(r.created_at),
        user: publicUser({ id: r.user_id, username: r.username, avatar: r.avatar, style: r.style }),
        reports: r.reports,
        reasons: Array.isArray(r.reasons) ? r.reasons : [],
        firstAt: toMs(r.first_at)
      }))
    })
  })

  /** Deals with the reports on a comment: `remove` deletes the comment, otherwise it stays. */
  app.post('/reports/:commentId', async (c) => {
    const id = /^\d{1,15}$/.test(c.req.param('commentId')) ? Number(c.req.param('commentId')) : fail(404, 'That comment is gone.')
    const { remove } = await body<{ remove: boolean }>(c)
    const [gc] = await sql<{ user_id: string; body: string }>`SELECT user_id, body FROM vanity.game_comments WHERE id = ${id}`
    if (remove === true) await sql`DELETE FROM vanity.game_comments WHERE id = ${id}`
    else await sql`UPDATE vanity.comment_reports SET resolved_at = now() WHERE comment_id = ${id} AND resolved_at IS NULL`
    await logAdmin(c.get('userId'), remove === true ? 'remove comment' : 'keep comment', gc?.user_id ?? null, (gc?.body ?? '').slice(0, 200))
    return c.body(null, 204)
  })

  /** What admins did lately. */
  app.get('/log', async (c) => {
    const rows = await sql<{ id: string | number; action: string; detail: string; created_at: unknown; admin: string | null; target: string | null; target_id: string | null }>`
      SELECT l.id, l.action, l.detail, l.created_at, a.username AS admin, t.username AS target, l.target_id
      FROM vanity.admin_log l LEFT JOIN vanity.profiles a ON a.id = l.admin_id LEFT JOIN vanity.profiles t ON t.id = l.target_id ORDER BY l.id DESC LIMIT 100`
    return c.json({ log: rows.map((l) => ({ id: Number(l.id), action: l.action, detail: l.detail, admin: l.admin, target: l.target, targetId: l.target_id, at: toMs(l.created_at) })) })
  })

  return app
}
