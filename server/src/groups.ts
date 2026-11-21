import { createHash, randomBytes } from 'node:crypto'
import { Hono, type MiddlewareHandler } from 'hono'
import type { GifResult, GroupChat, GroupMessage } from '../../src/shared/groups'
import { body, fail, toMs, type Env, type PublicUserFn } from './app'
import type { Sql } from './db'

// Group chats, GIF search (through KLIPY, so the key stays here) and uploaded GIFs.
// The same limits as src/shared/groups.ts (only its types are imported, since the deployed
// function is built from this folder alone); test/groups.test.ts checks they match.
export const MAX_GROUP_SIZE = 20
export const MAX_GROUP_NAME = 40
export const MAX_GIF_BYTES = 3 * 1024 * 1024
const MAX_MESSAGE = 2000
const PAGE = 50

const KLIPY_URL = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\/[\w\-./%?=&]{1,500}$/i
const MEDIA_REF = /^media:[A-Za-z0-9_-]{16,40}$/
/** A message that is a GIF must point at KLIPY or at a GIF uploaded here. */
export function validGifText(text: string): boolean {
  if (!text.startsWith('[gif] ')) return true
  const ref = text.slice(6).trim()
  return KLIPY_URL.test(ref) || MEDIA_REF.test(ref)
}

export interface GroupDeps {
  sql: Sql
  requireAuth: MiddlewareHandler<Env>
  requireUser: MiddlewareHandler<Env>
  areFriends(a: string, b: string): Promise<boolean>
  publicUser: PublicUserFn
  /** Throws when the account is banned or timed out. */
  canSpeak(userId: string): void
  /** KLIPY's key for GIF search ('' turns search off; uploads still work). */
  klipyKey: string
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>
  messageRateLimit: number
  now?: () => number
}

type MemberRow = { group_id: string; user_id: string; username: string; avatar: string | null; style: unknown; joined_at: unknown }
type MessageRow = { id: string | number; group_id: string; sender_id: string; body: string; created_at: unknown }

const message = (r: MessageRow): GroupMessage => ({ id: Number(r.id), senderId: r.sender_id, text: r.body, at: toMs(r.created_at) })

/** Cleans a group name: one line, trimmed, at most MAX_GROUP_NAME characters. */
function cleanName(v: unknown): string {
  const name = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
  if ([...name].length > MAX_GROUP_NAME) fail(400, `Group names can be up to ${MAX_GROUP_NAME} characters.`)
  return name
}

export function groupRoutes({ sql, requireAuth, requireUser, areFriends, publicUser, canSpeak, klipyKey, fetchFn, messageRateLimit, now = Date.now }: GroupDeps): { groups: Hono<Env>; gifs: Hono<Env>; media: Hono<Env> } {
  const sends = new Map<string, { count: number; reset: number }>()
  const limit = (map: Map<string, { count: number; reset: number }>, key: string, max: number, windowMs: number, message: string): void => {
    const t = Date.now()
    const s = map.get(key)
    if (!s || s.reset < t) map.set(key, { count: 1, reset: t + windowMs })
    else if (++s.count > max) fail(429, message)
  }

  async function memberOf(me: string, groupId: string): Promise<void> {
    const [row] = await sql`SELECT 1 FROM vanity.chat_group_members WHERE group_id = ${groupId} AND user_id = ${me}`
    if (!row) fail(404, "That group chat doesn't exist, or you're not in it.", 'no_group')
  }

  async function groupsFor(me: string, only?: string): Promise<GroupChat[]> {
    const groups = await sql<{ id: string; name: string; owner_id: string; last_read: string | number }>`
      SELECT g.id, g.name, g.owner_id, m.last_read FROM vanity.chat_groups g
      JOIN vanity.chat_group_members m ON m.group_id = g.id AND m.user_id = ${me}
      WHERE (${only ?? null}::text IS NULL OR g.id = ${only ?? null}) ORDER BY g.created_at`
    if (!groups.length) return []
    const ids = groups.map((g) => g.id)
    const members = await sql<MemberRow>`
      SELECT m.group_id, m.user_id, p.username, p.avatar, p.style, m.joined_at
      FROM vanity.chat_group_members m JOIN vanity.profiles p ON p.id = m.user_id
      WHERE m.group_id = ANY(${ids}::text[]) ORDER BY m.joined_at, p.username`
    const last = await sql<MessageRow & { sender_name: string }>`
      SELECT DISTINCT ON (gm.group_id) gm.id, gm.group_id, gm.sender_id, gm.body, gm.created_at, p.username AS sender_name
      FROM vanity.group_messages gm LEFT JOIN vanity.profiles p ON p.id = gm.sender_id
      WHERE gm.group_id = ANY(${ids}::text[]) ORDER BY gm.group_id, gm.id DESC`
    const unread = await sql<{ group_id: string; n: number }>`
      SELECT gm.group_id, COUNT(*)::int AS n FROM vanity.group_messages gm
      JOIN vanity.chat_group_members m ON m.group_id = gm.group_id AND m.user_id = ${me}
      WHERE gm.group_id = ANY(${ids}::text[]) AND gm.id > m.last_read AND gm.sender_id <> ${me} GROUP BY gm.group_id`
    return groups
      .map((g) => {
        const l = last.find((x) => x.group_id === g.id)
        return {
          id: g.id,
          name: g.name,
          ownerId: g.owner_id,
          members: members.filter((m) => m.group_id === g.id).map((m) => publicUser({ id: m.user_id, username: m.username, avatar: m.avatar, style: m.style })),
          unread: unread.find((u) => u.group_id === g.id)?.n ?? 0,
          lastMessage: l ? { id: Number(l.id), text: l.body, at: toMs(l.created_at), senderId: l.sender_id, senderName: l.sender_name ?? '' } : null
        }
      })
      .sort((a, b) => (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0))
  }

  /** Takes someone out of a group. The owner's place passes to whoever joined next; an empty group is deleted. */
  async function remove(groupId: string, userId: string): Promise<void> {
    await sql`DELETE FROM vanity.chat_group_members WHERE group_id = ${groupId} AND user_id = ${userId}`
    const [next] = await sql<{ user_id: string }>`SELECT user_id FROM vanity.chat_group_members WHERE group_id = ${groupId} ORDER BY joined_at, user_id LIMIT 1`
    if (!next) await sql`DELETE FROM vanity.chat_groups WHERE id = ${groupId}`
    else await sql`UPDATE vanity.chat_groups SET owner_id = ${next.user_id} WHERE id = ${groupId} AND owner_id = ${userId}`
  }

  const groups = new Hono<Env>()
  groups.use('*', requireAuth, requireUser)

  groups.get('/', async (c) => c.json({ groups: await groupsFor(c.get('userId')) }))

  /** Starts a group chat with some of your friends. */
  groups.post('/', async (c) => {
    const me = c.get('userId')
    const b = await body<{ name: string; memberIds: string[] }>(c)
    const ids = [...new Set(Array.isArray(b.memberIds) ? b.memberIds.filter((x): x is string => typeof x === 'string' && x !== me) : [])]
    if (ids.length < 1) fail(400, 'Pick at least one friend for the group.')
    if (ids.length + 1 > MAX_GROUP_SIZE) fail(400, `Group chats hold up to ${MAX_GROUP_SIZE} people.`)
    for (const id of ids) if (!(await areFriends(me, id))) fail(403, 'You can only add your friends to a group chat.')
    let name = cleanName(b.name)
    if (!name) {
      const names = await sql<{ username: string }>`SELECT username FROM vanity.profiles WHERE id = ANY(${[me, ...ids]}::text[]) ORDER BY username`
      name = names.map((n) => n.username).join(', ').slice(0, MAX_GROUP_NAME)
    }
    const id = randomBytes(9).toString('base64url')
    await sql`INSERT INTO vanity.chat_groups (id, name, owner_id) VALUES (${id}, ${name}, ${me})`
    for (const [i, uid] of [me, ...ids].entries()) {
      await sql`INSERT INTO vanity.chat_group_members (group_id, user_id, joined_at) VALUES (${id}, ${uid}, to_timestamp(${(now() + i) / 1000}))`
    }
    return c.json({ group: (await groupsFor(me, id))[0] }, 201)
  })

  /** Renames it (anyone in it). */
  groups.patch('/:id', async (c) => {
    const me = c.get('userId')
    const id = c.req.param('id')
    await memberOf(me, id)
    const name = cleanName((await body<{ name: string }>(c)).name)
    if (!name) fail(400, 'Give the group a name.')
    await sql`UPDATE vanity.chat_groups SET name = ${name} WHERE id = ${id}`
    return c.json({ group: (await groupsFor(me, id))[0] })
  })

  /** Adds one of your friends. */
  groups.post('/:id/members', async (c) => {
    const me = c.get('userId')
    const id = c.req.param('id')
    await memberOf(me, id)
    const { userId } = await body<{ userId: string }>(c)
    if (typeof userId !== 'string' || !(await areFriends(me, userId))) fail(403, 'You can only add your friends.')
    const [n] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.chat_group_members WHERE group_id = ${id}`
    if ((n?.n ?? 0) >= MAX_GROUP_SIZE) fail(409, `This group is full (${MAX_GROUP_SIZE} people).`)
    // They start reading from now on: earlier messages stay readable, but don't count as unread.
    const [top] = await sql<{ id: string | number | null }>`SELECT MAX(id) AS id FROM vanity.group_messages WHERE group_id = ${id}`
    await sql`INSERT INTO vanity.chat_group_members (group_id, user_id, joined_at, last_read) VALUES (${id}, ${userId!}, to_timestamp(${now() / 1000}), ${Number(top?.id ?? 0)}) ON CONFLICT DO NOTHING`
    return c.json({ group: (await groupsFor(me, id))[0] })
  })

  /** Leaves (yourself), or removes someone (only the owner). */
  groups.delete('/:id/members/:userId', async (c) => {
    const me = c.get('userId')
    const id = c.req.param('id')
    const who = c.req.param('userId') === 'me' ? me : c.req.param('userId')
    await memberOf(me, id)
    if (who !== me) {
      const [g] = await sql<{ owner_id: string }>`SELECT owner_id FROM vanity.chat_groups WHERE id = ${id}`
      if (g?.owner_id !== me) fail(403, 'Only the person who made the group can remove people.')
    }
    await remove(id, who)
    return c.body(null, 204)
  })

  /** A page of messages: the newest, older ones (before) or only newer ones (after). Reading marks them read. */
  groups.get('/:id/messages', async (c) => {
    const me = c.get('userId')
    const id = c.req.param('id')
    await memberOf(me, id)
    const before = Number(c.req.query('before')) || null
    const after = Number(c.req.query('after')) || null
    const rows = after
      ? await sql<MessageRow>`SELECT id, group_id, sender_id, body, created_at FROM vanity.group_messages WHERE group_id = ${id} AND id > ${after} ORDER BY id LIMIT ${PAGE + 1}`
      : await sql<MessageRow>`SELECT id, group_id, sender_id, body, created_at FROM vanity.group_messages WHERE group_id = ${id} AND (${before}::bigint IS NULL OR id < ${before}) ORDER BY id DESC LIMIT ${PAGE + 1}`
    const hasMore = !after && rows.length > PAGE
    const page = (after ? rows : rows.slice(0, PAGE).reverse()).map(message)
    const newest = page.at(-1)?.id
    if (newest) await sql`UPDATE vanity.chat_group_members SET last_read = GREATEST(last_read, ${newest}) WHERE group_id = ${id} AND user_id = ${me}`
    return c.json({ messages: page, hasMore })
  })

  groups.post('/:id/messages', async (c) => {
    const me = c.get('userId')
    const id = c.req.param('id')
    await memberOf(me, id)
    canSpeak(me)
    const { text } = await body<{ text: string }>(c)
    const clean = typeof text === 'string' ? text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim() : ''
    if (!clean) fail(400, 'Write a message first.')
    if ([...clean].length > MAX_MESSAGE) fail(400, `Messages can be up to ${MAX_MESSAGE.toLocaleString('en-US')} characters.`)
    if (!validGifText(clean)) fail(400, "That GIF can't be sent.")
    limit(sends, me, messageRateLimit, 60_000, "You're sending messages very fast. Wait a moment and try again.")
    const [row] = await sql<MessageRow>`INSERT INTO vanity.group_messages (group_id, sender_id, body) VALUES (${id}, ${me}, ${clean}) RETURNING id, group_id, sender_id, body, created_at`
    await sql`UPDATE vanity.chat_group_members SET last_read = ${Number(row.id)} WHERE group_id = ${id} AND user_id = ${me}`
    return c.json({ message: message(row) }, 201)
  })

  // ---- GIF search (KLIPY) -------------------------------------------------------------

  const gifs = new Hono<Env>()
  gifs.use('*', requireAuth, requireUser)
  const searches = new Map<string, { count: number; reset: number }>()
  /** Search ("q") or what's trending (no "q"). */
  gifs.get('/', async (c) => {
    if (!klipyKey) fail(404, "GIF search isn't set up on this server. You can still send GIFs from your device.", 'gifs_off')
    const me = c.get('userId')
    limit(searches, me, 60, 60_000, 'Searching GIFs very fast. Wait a moment.')
    const q = (c.req.query('q') ?? '').trim().slice(0, 80)
    const page = Math.max(1, Math.min(20, Number(c.req.query('page')) || 1))
    // KLIPY asks for a stable id per user (for its own rate limits); not the account id itself.
    const customer = createHash('sha256').update(`vanity:${me}`).digest('hex').slice(0, 32)
    const params = new URLSearchParams({ page: String(page), per_page: '24', customer_id: customer, content_filter: 'medium' })
    if (q) params.set('q', q)
    const url = `https://api.klipy.com/api/v1/${encodeURIComponent(klipyKey)}/gifs/${q ? 'search' : 'trending'}?${params}`
    let data: unknown
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`KLIPY ${res.status}`)
      data = await res.json()
    } catch {
      return c.json({ error: "GIF search isn't answering right now. Try again in a moment." }, 502)
    }
    return c.json({ gifs: parseKlipy(data) })
  })

  // ---- uploaded GIFs ------------------------------------------------------------------

  const media = new Hono<Env>()
  media.use('*', requireAuth, requireUser)
  const uploads = new Map<string, { count: number; reset: number }>()
  /** A GIF from your device, as base64. Only GIFs (checked by their first bytes), up to MAX_GIF_BYTES. */
  media.post('/', async (c) => {
    const me = c.get('userId')
    const { data } = await body<{ data: string }>(c)
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) fail(400, "That file couldn't be read.")
    const bytes = Buffer.from(data!, 'base64')
    if (bytes.length > MAX_GIF_BYTES) fail(400, `GIFs can be up to ${MAX_GIF_BYTES / 1024 / 1024} MB.`)
    if (bytes.subarray(0, 6).toString('ascii') !== 'GIF89a' && bytes.subarray(0, 6).toString('ascii') !== 'GIF87a') fail(400, "That isn't a GIF.")
    limit(uploads, me, 30, 60 * 60_000, "You've sent a lot of GIFs. Wait a while and try again.")
    const id = randomBytes(16).toString('base64url')
    await sql`INSERT INTO vanity.chat_media (id, owner_id, mime, data, size) VALUES (${id}, ${me}, 'image/gif', ${data!}, ${bytes.length})`
    return c.json({ id }, 201)
  })
  /** An uploaded GIF (anyone signed in who has its id: ids are long and random, and only travel in chats). */
  media.get('/:id', async (c) => {
    const [row] = await sql<{ mime: string; data: string }>`SELECT mime, data FROM vanity.chat_media WHERE id = ${c.req.param('id')}`
    if (!row) fail(404, 'That GIF is gone.')
    c.header('Cache-Control', 'private, max-age=31536000, immutable')
    return c.json({ mime: row!.mime, data: row!.data })
  })

  return { groups, gifs, media }
}

/**
 * KLIPY's answer, as a list of GIFs. Read loosely: the list may sit at data.data, data or
 * results, and each GIF's files at file.{md,sm,hd,xs}.{gif,webp}.url.
 */
export function parseKlipy(raw: unknown): GifResult[] {
  const root = raw as Record<string, unknown> | null
  const inner = root?.data as Record<string, unknown> | unknown[] | undefined
  const list = (Array.isArray(inner) ? inner : Array.isArray((inner as Record<string, unknown> | undefined)?.data) ? (inner as { data: unknown[] }).data : Array.isArray(root?.results) ? (root!.results as unknown[]) : []) as Record<string, unknown>[]
  const out: GifResult[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object' || (item.type && item.type !== 'gif')) continue
    const file = (item.file ?? {}) as Record<string, Record<string, { url?: string; width?: number; height?: number }>>
    const pick = (sizes: string[]): { url: string; width: number; height: number } | null => {
      for (const s of sizes) {
        const f = file[s]?.gif ?? file[s]?.webp
        if (f?.url && KLIPY_URL.test(f.url)) return { url: f.url, width: Number(f.width) || 0, height: Number(f.height) || 0 }
      }
      return null
    }
    const main = pick(['md', 'hd', 'sm', 'xs'])
    const small = pick(['sm', 'xs', 'md'])
    if (!main) continue
    out.push({ id: String(item.id ?? item.slug ?? main.url), url: main.url, preview: small?.url ?? main.url, width: main.width, height: main.height })
  }
  return out
}
