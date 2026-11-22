import { Hono, type MiddlewareHandler } from 'hono'
import { body, fail, toMs, type Env, type PublicUserFn } from './app'
import type { Sql } from './db'
import { maskProfanity } from './words'

// Comments on a game's page: one thread per game, the same for everyone who has that game.
// A comment belongs to an account id; the name and picture shown are that account's current ones.

export const MAX_COMMENT = 1000
const PAGE = 20
const GAME_KEY = /^g:[^\s]{1,190}$/

interface CommentDeps {
  sql: Sql
  requireAuth: MiddlewareHandler<Env>
  requireUser: MiddlewareHandler<Env>
  publicUser: PublicUserFn
  /** Throws when the account is banned or timed out. */
  canSpeak(userId: string): void
  /** Whether this account may remove that author's comment as an admin. */
  mayModerate(userId: string, authorId: string): boolean
  now: () => number
  /** Comments one account may post per minute, and per hour. */
  perMinute?: number
  perHour?: number
}

type Row = { id: string | number; game_key: string; user_id: string; body: string; created_at: unknown; edited_at: unknown; username: string; avatar: string | null; style: unknown }

/** One paragraph break at most, no control characters, no trailing space. */
const tidy = (text: string): string => text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

export function commentRoutes({ sql, requireAuth, requireUser, publicUser, canSpeak, mayModerate, now, perMinute = 4, perHour = 30 }: CommentDeps): Hono<Env> {
  const app = new Hono<Env>()
  const signedIn = [requireAuth, requireUser] as const

  const shape = (r: Row, me: string) => ({
    id: Number(r.id),
    gameKey: r.game_key,
    user: publicUser({ id: r.user_id, username: r.username, avatar: r.avatar, style: r.style }),
    text: r.body,
    at: toMs(r.created_at),
    editedAt: toMs(r.edited_at),
    mine: r.user_id === me
  })
  const one = async (id: number): Promise<Row | null> =>
    (await sql<Row>`SELECT c.id, c.game_key, c.user_id, c.body, c.created_at, c.edited_at, p.username, p.avatar, p.style FROM vanity.game_comments c JOIN vanity.profiles p ON p.id = c.user_id WHERE c.id = ${id}`)[0] ?? null
  const idOf = (v: string): number => (/^\d{1,15}$/.test(v) ? Number(v) : fail(404, 'That comment is gone.'))
  const textOf = (v: unknown): string => {
    if (typeof v !== 'string') fail(400, 'Write something first.')
    const text = maskProfanity(tidy(v as string))
    if (!text) fail(400, 'Write something first.')
    if ([...text].length > MAX_COMMENT) fail(400, `Comments can be up to ${MAX_COMMENT} characters.`)
    return text
  }

  /** A page of a game's comments, newest first. `before` (a comment id) gets the older ones. */
  app.get('/games/:key/comments', ...signedIn, async (c) => {
    const key = c.req.param('key')
    if (!GAME_KEY.test(key)) return c.json({ comments: [], hasMore: false, total: 0 })
    const before = /^\d{1,15}$/.test(c.req.query('before') ?? '') ? Number(c.req.query('before')) : null
    const rows = await sql<Row>`
      SELECT c.id, c.game_key, c.user_id, c.body, c.created_at, c.edited_at, p.username, p.avatar, p.style
      FROM vanity.game_comments c JOIN vanity.profiles p ON p.id = c.user_id
      WHERE c.game_key = ${key} AND (${before}::bigint IS NULL OR c.id < ${before}::bigint) ORDER BY c.id DESC LIMIT ${PAGE + 1}`
    const [n] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.game_comments WHERE game_key = ${key}`
    return c.json({ comments: rows.slice(0, PAGE).map((r) => shape(r, c.get('userId'))), hasMore: rows.length > PAGE, total: n?.n ?? 0 })
  })

  app.post('/games/:key/comments', ...signedIn, async (c) => {
    const me = c.get('userId')
    const key = c.req.param('key')
    if (!GAME_KEY.test(key)) fail(400, "Comments aren't available for this game.")
    canSpeak(me)
    const text = textOf((await body<{ text: string }>(c)).text)
    // Counted in the database, so the limit holds across every copy of the server.
    const [recent] = await sql<{ minute: number; hour: number; same: number }>`
      SELECT COUNT(*) FILTER (WHERE created_at > to_timestamp(${(now() - 60_000) / 1000}))::int AS minute,
             COUNT(*)::int AS hour,
             COUNT(*) FILTER (WHERE game_key = ${key} AND body = ${text})::int AS same
      FROM vanity.game_comments WHERE user_id = ${me} AND created_at > to_timestamp(${(now() - 3_600_000) / 1000})`
    if ((recent?.same ?? 0) > 0) fail(409, 'You already posted that here.')
    if ((recent?.minute ?? 0) >= perMinute) fail(429, "You're commenting very fast. Wait a minute and try again.")
    if ((recent?.hour ?? 0) >= perHour) fail(429, "That's a lot of comments. Take a break and try again later.")
    const [made] = await sql<{ id: string | number }>`INSERT INTO vanity.game_comments (game_key, user_id, body, created_at) VALUES (${key}, ${me}, ${text}, to_timestamp(${now() / 1000})) RETURNING id`
    return c.json({ comment: shape((await one(Number(made.id)))!, me) }, 201)
  })

  app.patch('/comments/:id', ...signedIn, async (c) => {
    const me = c.get('userId')
    const row = await one(idOf(c.req.param('id')))
    if (!row) fail(404, 'That comment is gone.')
    if (row!.user_id !== me) fail(403, 'You can only edit your own comments.')
    canSpeak(me)
    const text = textOf((await body<{ text: string }>(c)).text)
    if (text !== row!.body) await sql`UPDATE vanity.game_comments SET body = ${text}, edited_at = to_timestamp(${now() / 1000}) WHERE id = ${Number(row!.id)}`
    return c.json({ comment: shape((await one(Number(row!.id)))!, me) })
  })

  /** Your own comment; admins can remove anyone's. */
  app.delete('/comments/:id', ...signedIn, async (c) => {
    const me = c.get('userId')
    const row = await one(idOf(c.req.param('id')))
    if (!row) return c.body(null, 204)
    if (row.user_id !== me && !mayModerate(me, row.user_id)) fail(403, 'You can only delete your own comments.')
    await sql`DELETE FROM vanity.game_comments WHERE id = ${Number(row.id)}`
    return c.body(null, 204)
  })

  /** Tells the admins about a comment. Once per person per comment. */
  app.post('/comments/:id/report', ...signedIn, async (c) => {
    const me = c.get('userId')
    const row = await one(idOf(c.req.param('id')))
    if (!row) fail(404, 'That comment is gone.')
    if (row!.user_id === me) fail(400, "That's your own comment. You can delete it instead.")
    const { reason } = await body<{ reason: string }>(c)
    const [today] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.comment_reports WHERE reporter_id = ${me} AND created_at > to_timestamp(${(now() - 86_400_000) / 1000})`
    if ((today?.n ?? 0) >= 20) fail(429, "You've reported a lot today. Try again tomorrow.")
    await sql`INSERT INTO vanity.comment_reports (comment_id, reporter_id, reason, created_at) VALUES (${Number(row!.id)}, ${me}, ${typeof reason === 'string' ? tidy(reason).slice(0, 300) : ''}, to_timestamp(${now() / 1000})) ON CONFLICT DO NOTHING`
    return c.body(null, 204)
  })

  return app
}
