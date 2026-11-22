import { randomBytes } from 'node:crypto'
import { Hono, type MiddlewareHandler } from 'hono'
import { body, fail, toMs, type Env, type PublicUserFn } from './app'
import { can, INLINE_AUDIO, INLINE_IMAGE, INLINE_VIDEO, LIMITS, mentionedNames, rankOf, ROLE_COLORS, ROLES, TEMPLATES, tidyName, VISIBILITIES } from './communityRules'
import type { Attachment, Ban, Category, Channel, ChannelMessage, CommunityCard, CommunityDetail, CommunityMember, CustomRole, DirectInvite, Invite, JoinRequest, MessagePage, Permission, Reaction, Restriction, Role, Visibility } from './communityRules'
import type { Sql } from './db'
import { FILE_PART, type FileStore } from './files'
import { STYLE_OPTIONS } from './profileStyle'
import { maskProfanity } from './words'

// "Channels": communities with channels (rooms) inside them. See communityRules.ts for the naming
// (a community is what the app calls a Channel; a channel here is one of its rooms).
//
// What keeps a community private is decided here, on the server, on every request:
//  - A hidden community is never in Discover or search, and to anyone who isn't in it (and
//    holds no invite) it answers exactly like one that doesn't exist.
//  - Channels, messages and the member list are only ever given to members.
//  - Every action checks the caller's role in that community at that moment.
//  - A channel restricted to certain roles is left out, for everyone else, of the channel list,
//    of unread counts and of every message request, exactly as if it weren't there.
//  - A picture or file is fetched from an address with a long random part in it, which is only
//    ever given out inside messages, so only to people who may read that channel.

interface CommunityDeps {
  sql: Sql
  requireAuth: MiddlewareHandler<Env>
  requireUser: MiddlewareHandler<Env>
  publicUser: PublicUserFn
  /** Throws when the account is banned from Vanity or timed out. */
  canSpeak(userId: string): void
  /** A Vanity admin (the crown): may remove any community. */
  isVanityAdmin(userId: string): boolean
  messageRateLimit: number
  now: () => number
  /** Where pictures and files are kept, or null when that isn't set up. */
  files: FileStore | null
  areFriends(a: string, b: string): Promise<boolean>
}

export interface CommunityRoutes {
  routes: Hono<Env>
  /** Downloads: no sign-in, the address itself is the key. */
  files: Hono<Env>
  /** Deletes a community and everything in it, stored files included. */
  removeCommunity(communityId: string): Promise<void>
}

const ICON = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const MAX_ICON_CHARS = 60_000
const PAGE = 50
const ONLINE = "NOT pr.signed_off AND pr.updated_at > now() - interval '3 minutes'"
const id = (): string => randomBytes(9).toString('base64url')
/** Invite codes are typed and read aloud: no look-alike letters. */
const inviteCode = (): string => [...randomBytes(8)].map((b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('')
const NOT_FOUND = "That Channel doesn't exist, or you can't see it."

type CommunityRow = { id: string; name: string; description: string; icon: string | null; banner: string; visibility: Visibility; owner_id: string; created_at: unknown }
type MessageRow = { id: string | number; channel_id: string; community_id: string; sender_id: string; body: string; reply_to: string | number | null; created_at: unknown; edited_at: unknown; deleted_at: unknown; mentions: string | null; nonce: string | null; username: string | null; avatar: string | null; style: unknown }
type ChannelRow = { id: string; community_id: string; name: string; restricted: Restriction }
const isStaff = (role: Role): boolean => rankOf(role) >= 1
const list = (v: string | null | undefined): string[] => (v ? v.split(',').filter(Boolean) : [])
const FILE_TYPE = /^[a-z0-9][\w.+-]{0,60}\/[\w.+-]{1,80}$/i
const INLINE: readonly string[] = [...INLINE_IMAGE, ...INLINE_VIDEO, ...INLINE_AUDIO]

export function communityRoutes({ sql, requireAuth, requireUser, publicUser, canSpeak, isVanityAdmin, messageRateLimit, now, files, areFriends }: CommunityDeps): CommunityRoutes {
  const app = new Hono<Env>()
  app.use('*', requireAuth, requireUser)
  const sends = new Map<string, { count: number; reset: number }>()
  const ts = (): number => now() / 1000

  // ---- who may do what ----------------------------------------------------------

  const roleIn = async (communityId: string, userId: string): Promise<Role | null> =>
    (await sql<{ role: Role }>`SELECT role FROM vanity.community_members WHERE community_id = ${communityId} AND user_id = ${userId}`)[0]?.role ?? null

  /** The community and the caller's role in it, for members only. Anyone else: "doesn't exist". */
  async function asMember(communityId: string, me: string): Promise<{ c: CommunityRow; role: Role }> {
    const [c] = await sql<CommunityRow>`SELECT id, name, description, icon, banner, visibility, owner_id, created_at FROM vanity.communities WHERE id = ${communityId}`
    const role = c ? await roleIn(communityId, me) : null
    if (!c || !role) fail(404, NOT_FOUND, 'no_community')
    return { c: c!, role: role! }
  }
  /** The same, and the caller must hold a permission. */
  async function asStaff(communityId: string, me: string, permission: Permission): Promise<{ c: CommunityRow; role: Role }> {
    const found = await asMember(communityId, me)
    if (!can(found.role, permission)) fail(403, "You don't have permission to do that in this Channel.", 'no_permission')
    return found
  }
  /**
   * A channel (room) as the caller may use it, or null when they may not see it: they're not in
   * its community, or it is restricted to roles they don't hold. Staff are always let in.
   */
  async function channelAccess(channelId: string, me: string): Promise<{ channel: ChannelRow; role: Role; canPost: boolean } | null> {
    const [channel] = await sql<ChannelRow>`SELECT id, community_id, name, restricted FROM vanity.community_channels WHERE id = ${channelId}`
    const role = channel ? await roleIn(channel.community_id, me) : null
    if (!channel || !role) return null
    if (channel.restricted === 'none' || isStaff(role)) return { channel, role, canPost: true }
    const [held] = await sql`SELECT 1 FROM vanity.channel_role_access a JOIN vanity.community_member_roles mr ON mr.role_id = a.role_id AND mr.user_id = ${me} WHERE a.channel_id = ${channel.id} LIMIT 1`
    if (channel.restricted === 'view' && !held) return null
    return { channel, role, canPost: !!held }
  }
  /** The same, or "doesn't exist" for anyone who may not see it. */
  async function asChannelMember(channelId: string, me: string): Promise<{ channel: ChannelRow; role: Role; canPost: boolean }> {
    const found = await channelAccess(channelId, me)
    if (!found) fail(404, "That channel doesn't exist, or you can't see it.", 'no_channel')
    return found!
  }

  // ---- shaping ------------------------------------------------------------------

  async function cards(rows: CommunityRow[], me: string): Promise<CommunityCard[]> {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const counts = await sql<{ community_id: string; members: number; online: number }>`
      SELECT m.community_id, COUNT(*)::int AS members, COUNT(*) FILTER (WHERE NOT pr.signed_off AND pr.updated_at > now() - interval '3 minutes')::int AS online
      FROM vanity.community_members m LEFT JOIN vanity.presence pr ON pr.user_id = m.user_id
      WHERE m.community_id = ANY(${ids}::text[]) GROUP BY m.community_id`
    const mine = await sql<{ community_id: string; role: Role }>`SELECT community_id, role FROM vanity.community_members WHERE user_id = ${me} AND community_id = ANY(${ids}::text[])`
    const asked = await sql<{ community_id: string }>`SELECT community_id FROM vanity.community_requests WHERE user_id = ${me} AND community_id = ANY(${ids}::text[])`
    const joined = mine.map((m) => m.community_id)
    const unread = joined.length
      ? await sql<{ community_id: string; n: number; mentions: number }>`
          SELECT msg.community_id, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE ${me} = ANY(msg.mentions))::int AS mentions FROM vanity.channel_messages msg
          JOIN vanity.community_channels ch ON ch.id = msg.channel_id
          JOIN vanity.community_members mm ON mm.community_id = msg.community_id AND mm.user_id = ${me}
          LEFT JOIN vanity.channel_reads r ON r.channel_id = msg.channel_id AND r.user_id = ${me}
          WHERE msg.community_id = ANY(${joined}::text[]) AND msg.id > COALESCE(r.last_read, 0) AND msg.sender_id <> ${me} AND msg.deleted_at IS NULL
            AND (ch.restricted <> 'view' OR mm.role <> 'member' OR EXISTS (
              SELECT 1 FROM vanity.channel_role_access a JOIN vanity.community_member_roles mr ON mr.role_id = a.role_id AND mr.user_id = ${me} WHERE a.channel_id = ch.id))
          GROUP BY msg.community_id`
      : []
    return rows.map((r) => {
      const n = counts.find((c) => c.community_id === r.id)
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon,
        banner: r.banner,
        visibility: r.visibility,
        members: n?.members ?? 0,
        online: n?.online ?? 0,
        role: mine.find((m) => m.community_id === r.id)?.role ?? null,
        requested: asked.some((a) => a.community_id === r.id),
        unread: unread.find((u) => u.community_id === r.id)?.n ?? 0,
        mentions: unread.find((u) => u.community_id === r.id)?.mentions ?? 0
      }
    })
  }

  async function detail(c: CommunityRow, me: string, role: Role): Promise<CommunityDetail> {
    const [card] = await cards([c], me)
    const categories = await sql<{ id: string; name: string; position: number }>`SELECT id, name, position FROM vanity.community_categories WHERE community_id = ${c.id} ORDER BY position, name`
    const all = await sql<{ id: string; name: string; category_id: string | null; position: number; unread: number; mentions: number; restricted: Restriction; role_ids: string | null; held: boolean }>`
      SELECT ch.id, ch.name, ch.category_id, ch.position, ch.restricted,
        (SELECT string_agg(a.role_id, ',') FROM vanity.channel_role_access a WHERE a.channel_id = ch.id) AS role_ids,
        EXISTS (SELECT 1 FROM vanity.channel_role_access a JOIN vanity.community_member_roles mr ON mr.role_id = a.role_id AND mr.user_id = ${me} WHERE a.channel_id = ch.id) AS held,
        (SELECT COUNT(*) FROM vanity.channel_messages msg WHERE msg.channel_id = ch.id AND msg.sender_id <> ${me} AND msg.deleted_at IS NULL
          AND msg.id > COALESCE((SELECT last_read FROM vanity.channel_reads r WHERE r.channel_id = ch.id AND r.user_id = ${me}), 0))::int AS unread,
        (SELECT COUNT(*) FROM vanity.channel_messages msg WHERE msg.channel_id = ch.id AND msg.sender_id <> ${me} AND msg.deleted_at IS NULL AND ${me} = ANY(msg.mentions)
          AND msg.id > COALESCE((SELECT last_read FROM vanity.channel_reads r WHERE r.channel_id = ch.id AND r.user_id = ${me}), 0))::int AS mentions
      FROM vanity.community_channels ch WHERE ch.community_id = ${c.id} ORDER BY ch.position, ch.created_at`
    // A channel restricted to roles the caller doesn't hold isn't in their list at all.
    const staff = isStaff(role)
    const channels = all.filter((x) => staff || x.restricted !== 'view' || x.held)
    const myRoles = await sql<{ role_id: string }>`SELECT role_id FROM vanity.community_member_roles WHERE community_id = ${c.id} AND user_id = ${me}`
    const [waiting] = can(role, 'approveRequests') ? await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.community_requests WHERE community_id = ${c.id}` : [{ n: 0 }]
    return {
      ...card,
      ownerId: c.owner_id,
      categories: categories.map((x): Category => ({ id: x.id, name: x.name, position: x.position })),
      channels: channels.map((x): Channel => ({ id: x.id, name: x.name, categoryId: x.category_id, position: x.position, unread: x.unread, mentions: x.mentions, restricted: x.restricted, roleIds: list(x.role_ids), canPost: staff || x.restricted === 'none' || x.held })),
      pendingRequests: waiting?.n ?? 0,
      createdAt: toMs(c.created_at),
      roles: await rolesOf(c.id),
      myRoleIds: myRoles.map((r) => r.role_id),
      filesEnabled: !!files
    }
  }
  const rolesOf = async (communityId: string): Promise<CustomRole[]> =>
    (await sql<{ id: string; name: string; color: string; position: number }>`SELECT id, name, color, position FROM vanity.community_roles WHERE community_id = ${communityId} ORDER BY position, created_at`).map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position }))

  // ---- stored files ---------------------------------------------------------------

  /** Removes the bytes of files whose records are already gone (a few at a time). */
  async function sweepFiles(): Promise<void> {
    if (!files) return
    const gone = await sql<{ id: string; parts: number }>`SELECT id, parts FROM vanity.channel_files_gone ORDER BY at LIMIT 25`
    for (const f of gone) {
      try {
        await files.remove(f.id, f.parts)
        await sql`DELETE FROM vanity.channel_files_gone WHERE id = ${f.id}`
      } catch {
        return // The store is unreachable: they stay listed for next time.
      }
    }
  }
  async function removeCommunity(communityId: string): Promise<void> {
    await sql`INSERT INTO vanity.channel_files_gone (id, parts) SELECT id, parts FROM vanity.channel_files WHERE community_id = ${communityId} AND parts > 0 ON CONFLICT DO NOTHING`
    await sql`DELETE FROM vanity.communities WHERE id = ${communityId}`
    await sweepFiles()
  }
  async function removeFilesOf(where: { messageId: number } | { channelId: string }): Promise<void> {
    if ('messageId' in where) {
      await sql`INSERT INTO vanity.channel_files_gone (id, parts) SELECT id, parts FROM vanity.channel_files WHERE message_id = ${where.messageId} AND parts > 0 ON CONFLICT DO NOTHING`
      await sql`DELETE FROM vanity.channel_files WHERE message_id = ${where.messageId}`
    } else {
      await sql`INSERT INTO vanity.channel_files_gone (id, parts) SELECT id, parts FROM vanity.channel_files WHERE channel_id = ${where.channelId} AND parts > 0 ON CONFLICT DO NOTHING`
    }
  }

  /** Names and descriptions other people will see: tidy, and no blocked words. */
  function publicText(value: unknown, max: number, what: string, required = true): string {
    const text = tidyName(value, max)
    if (!text && required) fail(400, `Give it a ${what}.`)
    if (maskProfanity(text) !== text) fail(400, `That ${what} isn't allowed. Try another one.`, 'blocked_words')
    return text
  }
  const visibilityOf = (v: unknown): Visibility => (VISIBILITIES.some((x) => x.id === v) ? (v as Visibility) : fail(400, 'Pick Open, Private or Hidden.'))
  const bannerOf = (v: unknown): string => (typeof v === 'string' && (STYLE_OPTIONS.banner as readonly string[]).includes(v) ? v : 'default')
  const iconOf = (v: unknown): string | null => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'string' || !ICON.test(v) || v.length > MAX_ICON_CHARS) fail(400, 'That picture could not be used. Try a PNG or JPEG image.')
    return v as string
  }

  // ---- my communities, discover, last place ---------------------------------------

  app.get('/', async (c) => {
    const me = c.get('userId')
    const rows = await sql<CommunityRow>`
      SELECT co.id, co.name, co.description, co.icon, co.banner, co.visibility, co.owner_id, co.created_at
      FROM vanity.communities co JOIN vanity.community_members m ON m.community_id = co.id AND m.user_id = ${me} ORDER BY m.joined_at`
    const [place] = await sql<{ community_id: string | null; channel_id: string | null }>`SELECT community_id, channel_id FROM vanity.community_last_place WHERE user_id = ${me}`
    return c.json({ communities: await cards(rows, me), last: { communityId: place?.community_id ?? null, channelId: place?.channel_id ?? null } })
  })

  /**
   * Communities anyone may find: Open and Private ones, by the most members, or those whose name
   * or description contains `q`. Hidden ones are never here, whatever is searched for.
   */
  app.get('/discover', async (c) => {
    const me = c.get('userId')
    const q = tidyName(c.req.query('q'), 60).toLowerCase()
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`
    const rows = await sql<CommunityRow>`
      SELECT co.id, co.name, co.description, co.icon, co.banner, co.visibility, co.owner_id, co.created_at
      FROM vanity.communities co
      WHERE co.visibility IN ('open', 'private')
        AND (${q} = '' OR lower(co.name) LIKE ${like} OR lower(co.description) LIKE ${like})
        AND NOT EXISTS (SELECT 1 FROM vanity.community_bans b WHERE b.community_id = co.id AND b.user_id = ${me})
      ORDER BY (SELECT COUNT(*) FROM vanity.community_members m WHERE m.community_id = co.id) DESC, co.created_at LIMIT 60`
    return c.json({ communities: await cards(rows, me) })
  })

  app.put('/last-place', async (c) => {
    const me = c.get('userId')
    const b = await body<{ communityId: string | null; channelId: string | null }>(c)
    const communityId = typeof b.communityId === 'string' ? b.communityId.slice(0, 40) : null
    const channelId = typeof b.channelId === 'string' ? b.channelId.slice(0, 40) : null
    await sql`INSERT INTO vanity.community_last_place (user_id, community_id, channel_id, updated_at) VALUES (${me}, ${communityId}, ${channelId}, now())
      ON CONFLICT (user_id) DO UPDATE SET community_id = excluded.community_id, channel_id = excluded.channel_id, updated_at = now()`
    return c.body(null, 204)
  })

  // ---- invited directly -----------------------------------------------------------

  /** The communities someone has invited you into. */
  app.get('/direct-invites', async (c) => {
    const me = c.get('userId')
    const rows = await sql<CommunityRow & { by: string | null; invited_at: unknown }>`
      SELECT co.id, co.name, co.description, co.icon, co.banner, co.visibility, co.owner_id, co.created_at, p.username AS by, d.created_at AS invited_at
      FROM vanity.community_direct_invites d JOIN vanity.communities co ON co.id = d.community_id LEFT JOIN vanity.profiles p ON p.id = d.invited_by
      WHERE d.user_id = ${me} AND NOT EXISTS (SELECT 1 FROM vanity.community_bans b WHERE b.community_id = co.id AND b.user_id = ${me})
      ORDER BY d.created_at DESC LIMIT 50`
    const shaped = await cards(rows, me)
    return c.json({ invites: rows.map((r, i): DirectInvite => ({ community: shaped[i], by: r.by ?? 'Someone', at: toMs(r.invited_at) })) })
  })
  /** Accepts (you're in, whatever its visibility) or declines an invitation. */
  app.post('/direct-invites/:communityId', async (c) => {
    const me = c.get('userId')
    const communityId = c.req.param('communityId')
    const { accept } = await body<{ accept: boolean }>(c)
    const [invited] = await sql`SELECT 1 FROM vanity.community_direct_invites WHERE community_id = ${communityId} AND user_id = ${me}`
    if (!invited) fail(404, 'That invitation is gone.')
    if (accept !== true) {
      await sql`DELETE FROM vanity.community_direct_invites WHERE community_id = ${communityId} AND user_id = ${me}`
      return c.body(null, 204)
    }
    if (await banned(communityId, me)) fail(403, "You can't join this Channel.", 'banned_here')
    if (!(await roleIn(communityId, me))) await addMember(communityId, me)
    await sql`DELETE FROM vanity.community_direct_invites WHERE community_id = ${communityId} AND user_id = ${me}`
    const found = await asMember(communityId, me)
    return c.json({ community: await detail(found.c, me, found.role) })
  })

  // ---- create, read, change, delete ------------------------------------------------

  app.post('/', async (c) => {
    const me = c.get('userId')
    canSpeak(me)
    const b = await body<{ name: string; description: string; icon: string | null; banner: string; visibility: string; template: string }>(c)
    const name = publicText(b.name, LIMITS.communityName, 'name')
    if ([...name].length < 2) fail(400, 'Names need at least 2 characters.')
    const description = publicText(b.description, LIMITS.description, 'description', false)
    const visibility = visibilityOf(b.visibility ?? 'open')
    const template = TEMPLATES.find((t) => t.id === b.template) ?? TEMPLATES[TEMPLATES.length - 1]
    const [mine] = await sql<{ n: number; owned: number }>`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE role = 'owner')::int AS owned FROM vanity.community_members WHERE user_id = ${me}`
    if ((mine?.n ?? 0) >= LIMITS.joined) fail(409, `You're in ${LIMITS.joined} Channels, which is the most one account can be in. Leave one first.`)
    const communityId = id()
    await sql`INSERT INTO vanity.communities (id, name, description, icon, banner, visibility, owner_id, created_at) VALUES (${communityId}, ${name}, ${description}, ${iconOf(b.icon)}, ${bannerOf(b.banner)}, ${visibility}, ${me}, to_timestamp(${now() / 1000}))`
    await sql`INSERT INTO vanity.community_members (community_id, user_id, role, joined_at) VALUES (${communityId}, ${me}, 'owner', to_timestamp(${now() / 1000}))`
    let position = 0
    for (const [ci, cat] of template.categories.entries()) {
      const categoryId = id()
      await sql`INSERT INTO vanity.community_categories (id, community_id, name, position) VALUES (${categoryId}, ${communityId}, ${cat.name}, ${ci})`
      for (const channelName of cat.channels) await sql`INSERT INTO vanity.community_channels (id, community_id, category_id, name, position, created_at) VALUES (${id()}, ${communityId}, ${categoryId}, ${channelName}, ${position++}, to_timestamp(${(now() + position) / 1000}))`
    }
    const found = await asMember(communityId, me)
    return c.json({ community: await detail(found.c, me, found.role) }, 201)
  })

  /**
   * One community. A member gets all of it. Anyone else gets only its card, and only when it is
   * Open or Private; a Hidden one is "not found" to them.
   */
  app.get('/:id', async (c) => {
    const me = c.get('userId')
    const [co] = await sql<CommunityRow>`SELECT id, name, description, icon, banner, visibility, owner_id, created_at FROM vanity.communities WHERE id = ${c.req.param('id')}`
    const role = co ? await roleIn(co.id, me) : null
    if (co && role) return c.json({ community: await detail(co, me, role), member: true })
    if (!co || co.visibility === 'hidden') fail(404, NOT_FOUND, 'no_community')
    return c.json({ community: (await cards([co!], me))[0], member: false })
  })

  app.patch('/:id', async (c) => {
    const me = c.get('userId')
    const { c: co, role } = await asStaff(c.req.param('id'), me, 'manageCommunity')
    const b = await body<{ name: string; description: string; icon: string | null; banner: string; visibility: string }>(c)
    if (b.name !== undefined) {
      const name = publicText(b.name, LIMITS.communityName, 'name')
      if ([...name].length < 2) fail(400, 'Names need at least 2 characters.')
      await sql`UPDATE vanity.communities SET name = ${name} WHERE id = ${co.id}`
    }
    if (b.description !== undefined) await sql`UPDATE vanity.communities SET description = ${publicText(b.description, LIMITS.description, 'description', false)} WHERE id = ${co.id}`
    if (b.icon !== undefined) await sql`UPDATE vanity.communities SET icon = ${iconOf(b.icon)} WHERE id = ${co.id}`
    if (b.banner !== undefined) await sql`UPDATE vanity.communities SET banner = ${bannerOf(b.banner)} WHERE id = ${co.id}`
    if (b.visibility !== undefined) {
      // Who can find it is the owner's call.
      if (role !== 'owner') fail(403, 'Only the owner can change who can find this Channel.', 'no_permission')
      const visibility = visibilityOf(b.visibility)
      await sql`UPDATE vanity.communities SET visibility = ${visibility} WHERE id = ${co.id}`
      // Open now: nobody needs to wait to be let in.
      if (visibility === 'open') await sql`DELETE FROM vanity.community_requests WHERE community_id = ${co.id}`
    }
    const found = await asMember(co.id, me)
    return c.json({ community: await detail(found.c, me, found.role) })
  })

  /** The owner deletes it for everyone (a Vanity admin can too). */
  app.delete('/:id', async (c) => {
    const me = c.get('userId')
    const communityId = c.req.param('id')
    if (isVanityAdmin(me)) {
      await removeCommunity(communityId)
      return c.body(null, 204)
    }
    const { role } = await asMember(communityId, me)
    if (role !== 'owner') fail(403, 'Only the owner can delete this Channel.', 'no_permission')
    await removeCommunity(communityId)
    return c.body(null, 204)
  })

  /** Hands the community to another member; the old owner becomes an admin. */
  app.post('/:id/transfer', async (c) => {
    const me = c.get('userId')
    const { c: co, role } = await asMember(c.req.param('id'), me)
    if (role !== 'owner') fail(403, 'Only the owner can hand this Channel to someone else.', 'no_permission')
    const { userId } = await body<{ userId: string }>(c)
    if (typeof userId !== 'string' || userId === me || !(await roleIn(co.id, userId))) fail(400, 'Pick someone who is in this Channel.')
    await sql`UPDATE vanity.community_members SET role = 'admin' WHERE community_id = ${co.id} AND user_id = ${me}`
    await sql`UPDATE vanity.community_members SET role = 'owner' WHERE community_id = ${co.id} AND user_id = ${userId}`
    await sql`UPDATE vanity.communities SET owner_id = ${userId} WHERE id = ${co.id}`
    return c.body(null, 204)
  })

  // ---- joining and leaving ---------------------------------------------------------

  async function addMember(communityId: string, userId: string): Promise<void> {
    const [mine] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.community_members WHERE user_id = ${userId}`
    if ((mine?.n ?? 0) >= LIMITS.joined) fail(409, `That's ${LIMITS.joined} Channels, the most one account can be in. Leave one first.`)
    const [size] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.community_members WHERE community_id = ${communityId}`
    if ((size?.n ?? 0) >= LIMITS.members) fail(409, 'That Channel is full.')
    await sql`INSERT INTO vanity.community_members (community_id, user_id, role, joined_at) VALUES (${communityId}, ${userId}, 'member', to_timestamp(${now() / 1000})) ON CONFLICT DO NOTHING`
    await sql`DELETE FROM vanity.community_requests WHERE community_id = ${communityId} AND user_id = ${userId}`
    await sql`DELETE FROM vanity.community_direct_invites WHERE community_id = ${communityId} AND user_id = ${userId}`
    // A newcomer starts with nothing unread.
    await sql`INSERT INTO vanity.channel_reads (channel_id, user_id, last_read)
      SELECT ch.id, ${userId}, COALESCE((SELECT MAX(id) FROM vanity.channel_messages m WHERE m.channel_id = ch.id), 0) FROM vanity.community_channels ch WHERE ch.community_id = ${communityId}
      ON CONFLICT DO NOTHING`
  }
  const banned = async (communityId: string, userId: string): Promise<boolean> => (await sql`SELECT 1 FROM vanity.community_bans WHERE community_id = ${communityId} AND user_id = ${userId}`).length > 0

  /** Joins an Open community. */
  app.post('/:id/join', async (c) => {
    const me = c.get('userId')
    const [co] = await sql<CommunityRow>`SELECT id, name, description, icon, banner, visibility, owner_id, created_at FROM vanity.communities WHERE id = ${c.req.param('id')}`
    if (!co || co.visibility === 'hidden') fail(404, NOT_FOUND, 'no_community')
    if (await banned(co!.id, me)) fail(403, "You can't join this Channel.", 'banned_here')
    if (co!.visibility === 'private') fail(403, 'This Channel is private. Ask to join, or use an invite.', 'needs_request')
    await addMember(co!.id, me)
    const found = await asMember(co!.id, me)
    return c.json({ community: await detail(found.c, me, found.role) })
  })

  /** Asks to be let into a Private community. */
  app.post('/:id/request', async (c) => {
    const me = c.get('userId')
    canSpeak(me)
    const [co] = await sql<{ id: string; visibility: Visibility }>`SELECT id, visibility FROM vanity.communities WHERE id = ${c.req.param('id')}`
    if (!co || co.visibility === 'hidden') fail(404, NOT_FOUND, 'no_community')
    if (co!.visibility === 'open') fail(400, 'This Channel is open: you can just join.')
    if (await roleIn(co!.id, me)) fail(409, "You're already in this Channel.")
    if (await banned(co!.id, me)) fail(403, "You can't join this Channel.", 'banned_here')
    const { message } = await body<{ message: string }>(c)
    await sql`INSERT INTO vanity.community_requests (community_id, user_id, message, created_at) VALUES (${co!.id}, ${me}, ${maskProfanity(tidyName(message, 200))}, to_timestamp(${now() / 1000}))
      ON CONFLICT (community_id, user_id) DO UPDATE SET message = excluded.message`
    return c.body(null, 204)
  })
  app.delete('/:id/request', async (c) => {
    await sql`DELETE FROM vanity.community_requests WHERE community_id = ${c.req.param('id')} AND user_id = ${c.get('userId')}`
    return c.body(null, 204)
  })

  app.post('/:id/leave', async (c) => {
    const me = c.get('userId')
    const { c: co, role } = await asMember(c.req.param('id'), me)
    if (role === 'owner') {
      const [others] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.community_members WHERE community_id = ${co.id} AND user_id <> ${me}`
      if ((others?.n ?? 0) > 0) fail(409, "You own this Channel. Hand it to someone else first (Settings → Overview), or delete it.", 'owner_cant_leave')
      await removeCommunity(co.id)
      return c.body(null, 204)
    }
    await sql`DELETE FROM vanity.community_members WHERE community_id = ${co.id} AND user_id = ${me}`
    return c.body(null, 204)
  })

  // ---- members, roles, kicks, bans --------------------------------------------------

  app.get('/:id/members', async (c) => {
    const { c: co } = await asMember(c.req.param('id'), c.get('userId'))
    const offset = Math.max(0, Math.min(100_000, Math.trunc(Number(c.req.query('offset')) || 0)))
    const rows = await sql<{ user_id: string; role: Role; joined_at: unknown; username: string; avatar: string | null; style: unknown; online: boolean; role_ids: string | null }>`
      SELECT m.user_id, m.role, m.joined_at, p.username, p.avatar, p.style, COALESCE(NOT pr.signed_off AND pr.updated_at > now() - interval '3 minutes', false) AS online,
        (SELECT string_agg(mr.role_id, ',') FROM vanity.community_member_roles mr WHERE mr.community_id = m.community_id AND mr.user_id = m.user_id) AS role_ids
      FROM vanity.community_members m JOIN vanity.profiles p ON p.id = m.user_id LEFT JOIN vanity.presence pr ON pr.user_id = m.user_id
      WHERE m.community_id = ${co.id}
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'mod' THEN 2 ELSE 3 END, COALESCE(NOT pr.signed_off AND pr.updated_at > now() - interval '3 minutes', false) DESC, lower(p.username)
      LIMIT 101 OFFSET ${offset}`
    return c.json({
      members: rows.slice(0, 100).map((r): CommunityMember => ({ user: publicUser({ id: r.user_id, username: r.username, avatar: r.avatar, style: r.style }), role: r.role, online: r.online, joinedAt: toMs(r.joined_at), roleIds: list(r.role_ids) })),
      hasMore: rows.length > 100
    })
  })

  /** The caller must outrank the other person (and the role being given). */
  async function overMember(communityId: string, me: string, userId: string, permission: Permission): Promise<{ myRole: Role; theirRole: Role }> {
    const { role } = await asStaff(communityId, me, permission)
    const theirs = await roleIn(communityId, userId)
    if (!theirs) fail(404, "That person isn't in this Channel.")
    if (userId === me) fail(400, "You can't do that to yourself.")
    if (rankOf(theirs) >= rankOf(role)) fail(403, "You can't do that to someone with the same role as you, or a higher one.", 'no_permission')
    return { myRole: role, theirRole: theirs! }
  }

  app.patch('/:id/members/:userId', async (c) => {
    const me = c.get('userId')
    const communityId = c.req.param('id')
    const userId = c.req.param('userId')
    const { myRole } = await overMember(communityId, me, userId, 'manageRoles')
    const { role } = await body<{ role: Role }>(c)
    if (!ROLES.some((r) => r.id === role) || role === 'owner') fail(400, 'Pick Admin, Moderator or Member.')
    if (rankOf(role) >= rankOf(myRole)) fail(403, "You can only give roles below your own.", 'no_permission')
    await sql`UPDATE vanity.community_members SET role = ${role} WHERE community_id = ${communityId} AND user_id = ${userId}`
    return c.body(null, 204)
  })

  /** Takes someone out. They can come back (unless they're also banned). */
  app.delete('/:id/members/:userId', async (c) => {
    const communityId = c.req.param('id')
    const userId = c.req.param('userId')
    await overMember(communityId, c.get('userId'), userId, 'kick')
    await sql`DELETE FROM vanity.community_members WHERE community_id = ${communityId} AND user_id = ${userId}`
    return c.body(null, 204)
  })

  // ---- custom roles ------------------------------------------------------------------
  // A name and a colour the owner makes up. Holding one shows its colour on your name and lets
  // you into channels restricted to it. What someone may *do* still comes from Owner / Admin /
  // Moderator / Member.

  const colorOf = (v: unknown): string => ((ROLE_COLORS as readonly string[]).includes(v as string) ? (v as string) : ROLE_COLORS[ROLE_COLORS.length - 1])
  const roleName = (v: unknown): string => {
    const name = tidyName(v, LIMITS.roleName)
    if (!name) fail(400, 'A role needs a name.')
    if (maskProfanity(name) !== name) fail(400, "That name isn't allowed. Try another one.", 'blocked_words')
    return name
  }
  const ownerOnly = async (communityId: string, me: string): Promise<void> => {
    const { role } = await asMember(communityId, me)
    if (role !== 'owner') fail(403, 'Only the owner can create, change or delete roles.', 'no_permission')
  }
  app.post('/:id/roles', async (c) => {
    const communityId = c.req.param('id')
    await ownerOnly(communityId, c.get('userId'))
    const b = await body<{ name: string; color: string }>(c)
    const name = roleName(b.name)
    const [n] = await sql<{ n: number; next: number }>`SELECT COUNT(*)::int AS n, COALESCE(MAX(position), -1)::int + 1 AS next FROM vanity.community_roles WHERE community_id = ${communityId}`
    if ((n?.n ?? 0) >= LIMITS.customRoles) fail(409, `A Channel can have up to ${LIMITS.customRoles} custom roles.`)
    const role: CustomRole = { id: id(), name, color: colorOf(b.color), position: n?.next ?? 0 }
    await sql`INSERT INTO vanity.community_roles (id, community_id, name, color, position, created_at) VALUES (${role.id}, ${communityId}, ${role.name}, ${role.color}, ${role.position}, to_timestamp(${ts()}))`
    return c.json({ role }, 201)
  })
  const customRole = async (roleId: string): Promise<{ id: string; community_id: string }> => {
    const [role] = await sql<{ id: string; community_id: string }>`SELECT id, community_id FROM vanity.community_roles WHERE id = ${roleId}`
    if (!role) fail(404, 'That role is gone.')
    return role!
  }
  app.patch('/roles/:roleId', async (c) => {
    const role = await customRole(c.req.param('roleId'))
    await ownerOnly(role.community_id, c.get('userId'))
    const b = await body<{ name: string; color: string }>(c)
    if (b.name !== undefined) await sql`UPDATE vanity.community_roles SET name = ${roleName(b.name)} WHERE id = ${role.id}`
    if (b.color !== undefined) await sql`UPDATE vanity.community_roles SET color = ${colorOf(b.color)} WHERE id = ${role.id}`
    return c.body(null, 204)
  })
  /** Deleting a role takes it off everyone and off every channel it was opening. */
  app.delete('/roles/:roleId', async (c) => {
    const role = await customRole(c.req.param('roleId'))
    await ownerOnly(role.community_id, c.get('userId'))
    await sql`DELETE FROM vanity.community_roles WHERE id = ${role.id}`
    return c.body(null, 204)
  })
  /** Sets which custom roles someone holds. Yourself, or someone below you. */
  app.put('/:id/members/:userId/roles', async (c) => {
    const me = c.get('userId')
    const communityId = c.req.param('id')
    const userId = c.req.param('userId')
    if (userId === me) await asStaff(communityId, me, 'manageRoles')
    else await overMember(communityId, me, userId, 'manageRoles')
    const { roleIds } = await body<{ roleIds: string[] }>(c)
    const wanted = Array.isArray(roleIds) ? roleIds.filter((r): r is string => typeof r === 'string').slice(0, LIMITS.customRoles) : []
    const known = (await sql<{ id: string }>`SELECT id FROM vanity.community_roles WHERE community_id = ${communityId}`).map((r) => r.id).filter((r) => wanted.includes(r))
    await sql`DELETE FROM vanity.community_member_roles WHERE community_id = ${communityId} AND user_id = ${userId}`
    for (const roleId of known) await sql`INSERT INTO vanity.community_member_roles (community_id, user_id, role_id) VALUES (${communityId}, ${userId}, ${roleId}) ON CONFLICT DO NOTHING`
    return c.json({ roleIds: known })
  })

  app.get('/:id/bans', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'ban')
    const rows = await sql<{ user_id: string; reason: string; created_at: unknown; username: string; avatar: string | null; style: unknown }>`
      SELECT b.user_id, b.reason, b.created_at, p.username, p.avatar, p.style FROM vanity.community_bans b JOIN vanity.profiles p ON p.id = b.user_id WHERE b.community_id = ${co.id} ORDER BY b.created_at DESC`
    return c.json({ bans: rows.map((r): Ban => ({ user: publicUser({ id: r.user_id, username: r.username, avatar: r.avatar, style: r.style }), reason: r.reason, at: toMs(r.created_at) })) })
  })
  /** Takes someone out and keeps them out (invites and requests included). */
  app.post('/:id/bans', async (c) => {
    const me = c.get('userId')
    const communityId = c.req.param('id')
    const b = await body<{ userId: string; reason: string }>(c)
    if (typeof b.userId !== 'string') fail(400, 'Pick someone to ban.')
    // Someone who already left can be banned too; a member must be outranked.
    if (await roleIn(communityId, b.userId!)) await overMember(communityId, me, b.userId!, 'ban')
    else await asStaff(communityId, me, 'ban')
    if (!(await sql`SELECT 1 FROM vanity.profiles WHERE id = ${b.userId}`).length) fail(404, "That account doesn't exist.")
    await sql`DELETE FROM vanity.community_members WHERE community_id = ${communityId} AND user_id = ${b.userId}`
    await sql`DELETE FROM vanity.community_requests WHERE community_id = ${communityId} AND user_id = ${b.userId}`
    await sql`INSERT INTO vanity.community_bans (community_id, user_id, banned_by, reason, created_at) VALUES (${communityId}, ${b.userId}, ${me}, ${tidyName(b.reason, 200)}, to_timestamp(${now() / 1000}))
      ON CONFLICT (community_id, user_id) DO UPDATE SET reason = excluded.reason`
    return c.body(null, 204)
  })
  app.delete('/:id/bans/:userId', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'ban')
    await sql`DELETE FROM vanity.community_bans WHERE community_id = ${co.id} AND user_id = ${c.req.param('userId')}`
    return c.body(null, 204)
  })

  // ---- join requests -----------------------------------------------------------------

  app.get('/:id/requests', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'approveRequests')
    const rows = await sql<{ user_id: string; message: string; created_at: unknown; username: string; avatar: string | null; style: unknown }>`
      SELECT r.user_id, r.message, r.created_at, p.username, p.avatar, p.style FROM vanity.community_requests r JOIN vanity.profiles p ON p.id = r.user_id WHERE r.community_id = ${co.id} ORDER BY r.created_at`
    return c.json({ requests: rows.map((r): JoinRequest => ({ user: publicUser({ id: r.user_id, username: r.username, avatar: r.avatar, style: r.style }), message: r.message, at: toMs(r.created_at) })) })
  })
  app.post('/:id/requests/:userId', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'approveRequests')
    const userId = c.req.param('userId')
    const { approve } = await body<{ approve: boolean }>(c)
    const [asked] = await sql`SELECT 1 FROM vanity.community_requests WHERE community_id = ${co.id} AND user_id = ${userId}`
    if (!asked) fail(404, 'That request is gone.')
    if (approve === true) await addMember(co.id, userId)
    await sql`DELETE FROM vanity.community_requests WHERE community_id = ${co.id} AND user_id = ${userId}`
    return c.body(null, 204)
  })

  // ---- invites -------------------------------------------------------------------------

  app.get('/:id/invites', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'invite')
    const rows = await sql<{ code: string; expires_at: unknown; max_uses: number | null; uses: number; created_at: unknown; username: string | null }>`
      SELECT i.code, i.expires_at, i.max_uses, i.uses, i.created_at, p.username FROM vanity.community_invites i LEFT JOIN vanity.profiles p ON p.id = i.created_by WHERE i.community_id = ${co.id} ORDER BY i.created_at DESC`
    return c.json({ invites: rows.map((r): Invite => ({ code: r.code, createdBy: r.username ?? 'someone who left', expiresAt: toMs(r.expires_at), maxUses: r.max_uses, uses: r.uses, createdAt: toMs(r.created_at) })) })
  })
  app.post('/:id/invites', async (c) => {
    const me = c.get('userId')
    const { c: co } = await asStaff(c.req.param('id'), me, 'invite')
    const b = await body<{ expiresHours: number | null; maxUses: number | null }>(c)
    const hours = b.expiresHours == null ? null : Math.trunc(Number(b.expiresHours))
    const uses = b.maxUses == null ? null : Math.trunc(Number(b.maxUses))
    if (hours !== null && (!Number.isFinite(hours) || hours < 1 || hours > 24 * 365)) fail(400, 'An invite can last from an hour to a year, or never run out.')
    if (uses !== null && (!Number.isFinite(uses) || uses < 1 || uses > 10_000)) fail(400, 'An invite can be used from 1 to 10,000 times, or with no limit.')
    const [n] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.community_invites WHERE community_id = ${co.id}`
    if ((n?.n ?? 0) >= LIMITS.invites) fail(409, `This Channel has ${LIMITS.invites} invites. Revoke one first.`)
    const code = inviteCode()
    const expires = hours === null ? null : (now() + hours * 3_600_000) / 1000
    await sql`INSERT INTO vanity.community_invites (code, community_id, created_by, expires_at, max_uses, created_at)
      VALUES (${code}, ${co.id}, ${me}, CASE WHEN ${expires}::float8 IS NULL THEN NULL ELSE to_timestamp(${expires}::float8) END, ${uses}, to_timestamp(${now() / 1000}))`
    return c.json({ invite: { code, createdBy: '', expiresAt: expires === null ? null : expires * 1000, maxUses: uses, uses: 0, createdAt: now() } satisfies Invite }, 201)
  })
  app.delete('/:id/invites/:code', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'invite')
    await sql`DELETE FROM vanity.community_invites WHERE community_id = ${co.id} AND code = ${c.req.param('code').toUpperCase()}`
    return c.body(null, 204)
  })

  /**
   * Invites one of your friends straight in (they accept or decline in their Channels tab).
   * Friends only, so an invite can't be used to pester strangers.
   */
  app.post('/:id/direct-invites', async (c) => {
    const me = c.get('userId')
    const { c: co } = await asStaff(c.req.param('id'), me, 'invite')
    canSpeak(me)
    const { userId } = await body<{ userId: string }>(c)
    if (typeof userId !== 'string' || userId === me || !(await areFriends(me, userId))) fail(400, 'You can invite people on your friends list.')
    if (await roleIn(co.id, userId!)) fail(409, "They're already in this Channel.")
    if (await banned(co.id, userId!)) fail(409, 'That person is banned from this Channel. Lift the ban first.')
    await sql`INSERT INTO vanity.community_direct_invites (community_id, user_id, invited_by, created_at) VALUES (${co.id}, ${userId}, ${me}, to_timestamp(${ts()})) ON CONFLICT DO NOTHING`
    return c.body(null, 204)
  })
  /** Who has been invited and hasn't answered yet. */
  app.get('/:id/direct-invites', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'invite')
    const rows = await sql<{ user_id: string }>`SELECT user_id FROM vanity.community_direct_invites WHERE community_id = ${co.id}`
    return c.json({ invited: rows.map((r) => r.user_id) })
  })
  app.delete('/:id/direct-invites/:userId', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'invite')
    await sql`DELETE FROM vanity.community_direct_invites WHERE community_id = ${co.id} AND user_id = ${c.req.param('userId')}`
    return c.body(null, 204)
  })

  /** An invite that still works, and the community it is for. */
  async function liveInvite(code: string): Promise<{ invite: { code: string; community_id: string }; co: CommunityRow }> {
    const [invite] = await sql<{ code: string; community_id: string }>`
      SELECT code, community_id FROM vanity.community_invites
      WHERE code = ${code.trim().toUpperCase().slice(0, 20)} AND (expires_at IS NULL OR expires_at > to_timestamp(${now() / 1000})) AND (max_uses IS NULL OR uses < max_uses)`
    const [co] = invite ? await sql<CommunityRow>`SELECT id, name, description, icon, banner, visibility, owner_id, created_at FROM vanity.communities WHERE id = ${invite.community_id}` : []
    if (!invite || !co) fail(404, "That invite doesn't work. It may have run out, been used up or been revoked.", 'bad_invite')
    return { invite: invite!, co: co! }
  }
  /** What an invite is for (a card), so you can see it before joining. This is how a Hidden one is seen at all. */
  app.get('/invites/:code', async (c) => {
    const { co } = await liveInvite(c.req.param('code'))
    return c.json({ community: (await cards([co], c.get('userId')))[0] })
  })
  app.post('/invites/:code/join', async (c) => {
    const me = c.get('userId')
    // Someone already in it just opens it, whatever has become of the invite since.
    const [known] = await sql<{ community_id: string }>`SELECT community_id FROM vanity.community_invites WHERE code = ${c.req.param('code').trim().toUpperCase().slice(0, 20)}`
    if (known && (await roleIn(known.community_id, me))) {
      const already = await asMember(known.community_id, me)
      return c.json({ community: await detail(already.c, me, already.role) })
    }
    const { invite, co } = await liveInvite(c.req.param('code'))
    if (await banned(co.id, me)) fail(403, "You can't join this Channel.", 'banned_here')
    if (!(await roleIn(co.id, me))) {
      // Counted only if there is still a use left at this very moment (two people, one last use).
      const used = await sql`UPDATE vanity.community_invites SET uses = uses + 1 WHERE code = ${invite.code} AND (max_uses IS NULL OR uses < max_uses) RETURNING code`
      if (!used.length) fail(404, "That invite doesn't work. It may have run out, been used up or been revoked.", 'bad_invite')
      await addMember(co.id, me)
    }
    const found = await asMember(co.id, me)
    return c.json({ community: await detail(found.c, me, found.role) })
  })

  // ---- categories and channels (rooms) ------------------------------------------------

  /** A channel's name: spaces, capitals and emoji are kept as typed. */
  const channelName = (v: unknown): string => {
    const name = tidyName(v, LIMITS.channelName)
    if (!name) fail(400, "A channel needs a name.")
    return name
  }

  app.post('/:id/categories', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'manageChannels')
    const name = tidyName((await body<{ name: string }>(c)).name, LIMITS.categoryName)
    if (!name) fail(400, 'A category needs a name.')
    const [n] = await sql<{ n: number; next: number }>`SELECT COUNT(*)::int AS n, COALESCE(MAX(position), -1)::int + 1 AS next FROM vanity.community_categories WHERE community_id = ${co.id}`
    if ((n?.n ?? 0) >= LIMITS.categories) fail(409, `A Channel can have up to ${LIMITS.categories} categories.`)
    const categoryId = id()
    await sql`INSERT INTO vanity.community_categories (id, community_id, name, position) VALUES (${categoryId}, ${co.id}, ${name}, ${n?.next ?? 0})`
    return c.json({ category: { id: categoryId, name, position: n?.next ?? 0 } satisfies Category }, 201)
  })
  const categoryIn = async (categoryId: string): Promise<{ id: string; community_id: string }> => {
    const [cat] = await sql<{ id: string; community_id: string }>`SELECT id, community_id FROM vanity.community_categories WHERE id = ${categoryId}`
    if (!cat) fail(404, 'That category is gone.')
    return cat!
  }
  app.patch('/categories/:categoryId', async (c) => {
    const cat = await categoryIn(c.req.param('categoryId'))
    await asStaff(cat.community_id, c.get('userId'), 'manageChannels')
    const name = tidyName((await body<{ name: string }>(c)).name, LIMITS.categoryName)
    if (!name) fail(400, 'A category needs a name.')
    await sql`UPDATE vanity.community_categories SET name = ${name} WHERE id = ${cat.id}`
    return c.body(null, 204)
  })
  /** Deletes a category; its channels stay, without a category. */
  app.delete('/categories/:categoryId', async (c) => {
    const cat = await categoryIn(c.req.param('categoryId'))
    await asStaff(cat.community_id, c.get('userId'), 'manageChannels')
    await sql`DELETE FROM vanity.community_categories WHERE id = ${cat.id}`
    return c.body(null, 204)
  })

  app.post('/:id/channels', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'manageChannels')
    const b = await body<{ name: string; categoryId: string | null }>(c)
    const name = channelName(b.name)
    const [n] = await sql<{ n: number; next: number }>`SELECT COUNT(*)::int AS n, COALESCE(MAX(position), -1)::int + 1 AS next FROM vanity.community_channels WHERE community_id = ${co.id}`
    if ((n?.n ?? 0) >= LIMITS.channels) fail(409, `A Channel can have up to ${LIMITS.channels} channels.`)
    let categoryId: string | null = null
    if (typeof b.categoryId === 'string' && b.categoryId) {
      const cat = await categoryIn(b.categoryId)
      if (cat.community_id !== co.id) fail(400, 'That category belongs to another Channel.')
      categoryId = cat.id
    }
    const channelId = id()
    await sql`INSERT INTO vanity.community_channels (id, community_id, category_id, name, position, created_at) VALUES (${channelId}, ${co.id}, ${categoryId}, ${name}, ${n?.next ?? 0}, to_timestamp(${now() / 1000}))`
    return c.json({ channel: { id: channelId, name, categoryId, position: n?.next ?? 0, unread: 0, mentions: 0, restricted: 'none', roleIds: [], canPost: true } satisfies Channel }, 201)
  })
  app.patch('/channels/:channelId', async (c) => {
    const me = c.get('userId')
    const { channel, role } = await asChannelMember(c.req.param('channelId'), me)
    if (!can(role, 'manageChannels')) fail(403, "You don't have permission to do that in this Channel.", 'no_permission')
    const b = await body<{ name: string; restricted: Restriction; roleIds: string[] }>(c)
    if (b.name !== undefined) await sql`UPDATE vanity.community_channels SET name = ${channelName(b.name)} WHERE id = ${channel.id}`
    // Who it is for: everyone, or only some roles (to see it, or just to write in it).
    if (b.restricted !== undefined) {
      if (!['none', 'view', 'post'].includes(b.restricted)) fail(400, 'Pick who this channel is for.')
      await sql`UPDATE vanity.community_channels SET restricted = ${b.restricted} WHERE id = ${channel.id}`
    }
    if (b.roleIds !== undefined) {
      const wanted = Array.isArray(b.roleIds) ? b.roleIds.filter((r): r is string => typeof r === 'string') : []
      const known = (await sql<{ id: string }>`SELECT id FROM vanity.community_roles WHERE community_id = ${channel.community_id}`).map((r) => r.id).filter((r) => wanted.includes(r))
      await sql`DELETE FROM vanity.channel_role_access WHERE channel_id = ${channel.id}`
      for (const roleId of known) await sql`INSERT INTO vanity.channel_role_access (channel_id, role_id) VALUES (${channel.id}, ${roleId}) ON CONFLICT DO NOTHING`
    }
    return c.body(null, 204)
  })
  app.delete('/channels/:channelId', async (c) => {
    const { channel, role } = await asChannelMember(c.req.param('channelId'), c.get('userId'))
    if (!can(role, 'manageChannels')) fail(403, "You don't have permission to do that in this Channel.", 'no_permission')
    await removeFilesOf({ channelId: channel.id })
    await sql`DELETE FROM vanity.community_channels WHERE id = ${channel.id}`
    await sweepFiles()
    return c.body(null, 204)
  })

  /**
   * The whole order at once (after a drag): categories in order, each with its channels in
   * order, and the channels that sit in no category. Anything not from this community is ignored.
   */
  app.put('/:id/layout', async (c) => {
    const { c: co } = await asStaff(c.req.param('id'), c.get('userId'), 'manageChannels')
    const b = await body<{ categories: { id: string; channels: string[] }[]; uncategorized: string[] }>(c)
    const categories = Array.isArray(b.categories) ? b.categories.slice(0, LIMITS.categories) : []
    const knownCats = new Set((await sql<{ id: string }>`SELECT id FROM vanity.community_categories WHERE community_id = ${co.id}`).map((x) => x.id))
    const knownChannels = new Set((await sql<{ id: string }>`SELECT id FROM vanity.community_channels WHERE community_id = ${co.id}`).map((x) => x.id))
    let position = 0
    const place = async (channelId: unknown, categoryId: string | null): Promise<void> => {
      if (typeof channelId !== 'string' || !knownChannels.delete(channelId)) return
      await sql`UPDATE vanity.community_channels SET category_id = ${categoryId}, position = ${position++} WHERE id = ${channelId}`
    }
    for (const channelId of Array.isArray(b.uncategorized) ? b.uncategorized.slice(0, LIMITS.channels) : []) await place(channelId, null)
    for (const [i, cat] of categories.entries()) {
      if (!cat || typeof cat.id !== 'string' || !knownCats.has(cat.id)) continue
      await sql`UPDATE vanity.community_categories SET position = ${i} WHERE id = ${cat.id}`
      for (const channelId of Array.isArray(cat.channels) ? cat.channels.slice(0, LIMITS.channels) : []) await place(channelId, cat.id)
    }
    const found = await asMember(co.id, c.get('userId'))
    return c.json({ community: await detail(found.c, c.get('userId'), found.role) })
  })

  // ---- messages ------------------------------------------------------------------------

  const COLUMNS = `m.id, m.channel_id, m.community_id, m.sender_id, m.body, m.reply_to, m.created_at, m.edited_at, m.deleted_at, array_to_string(m.mentions, ',') AS mentions, m.nonce, p.username, p.avatar, p.style`
  void COLUMNS // (the column list, written out in each query below because queries are tagged templates)

  const attachmentOf = (f: { id: string; token: string; name: string; size: string | number; type: string }): Attachment => ({ id: f.id, name: f.name, size: Number(f.size), type: f.type, path: `/files/${f.id}/${f.token}/${encodeURIComponent(f.name)}` })

  async function shape(rows: MessageRow[], me: string): Promise<ChannelMessage[]> {
    if (!rows.length) return []
    const ids = rows.map((r) => Number(r.id))
    const reacted = await sql<{ message_id: string | number; emoji: string; n: number; mine: boolean }>`
      SELECT message_id, emoji, COUNT(*)::int AS n, bool_or(user_id = ${me}) AS mine, MIN(created_at) AS first
      FROM vanity.channel_reactions WHERE message_id = ANY(${ids}::bigint[]) GROUP BY message_id, emoji ORDER BY MIN(created_at)`
    const quoted = [...new Set(rows.map((r) => (r.reply_to === null ? null : Number(r.reply_to))).filter((x): x is number => x !== null))]
    const quotes = quoted.length
      ? await sql<{ id: string | number; body: string; deleted_at: unknown; username: string | null; files: number }>`
          SELECT m.id, m.body, m.deleted_at, p.username, (SELECT COUNT(*) FROM vanity.channel_files f WHERE f.message_id = m.id)::int AS files
          FROM vanity.channel_messages m LEFT JOIN vanity.profiles p ON p.id = m.sender_id WHERE m.id = ANY(${quoted}::bigint[])`
      : []
    const attached = await sql<{ id: string; token: string; message_id: string | number; name: string; size: string | number; type: string }>`
      SELECT id, token, message_id, name, size, type FROM vanity.channel_files WHERE message_id = ANY(${ids}::bigint[]) AND ready ORDER BY created_at, id`
    // The colour of each sender's top custom role, and the current names of everyone mentioned.
    const communities = [...new Set(rows.map((r) => r.community_id))]
    const senders = [...new Set(rows.map((r) => r.sender_id))]
    const colors = await sql<{ community_id: string; user_id: string; color: string }>`
      SELECT mr.community_id, mr.user_id, r.color FROM vanity.community_member_roles mr JOIN vanity.community_roles r ON r.id = mr.role_id
      WHERE mr.community_id = ANY(${communities}::text[]) AND mr.user_id = ANY(${senders}::text[]) ORDER BY r.position, r.created_at`
    const named = [...new Set(rows.flatMap((r) => list(r.mentions)))]
    const names = named.length ? await sql<{ id: string; username: string }>`SELECT id, username FROM vanity.profiles WHERE id = ANY(${named}::text[]) AND username IS NOT NULL` : []
    return rows.map((r) => {
      const deleted = r.deleted_at !== null && r.deleted_at !== undefined
      const q = r.reply_to === null ? null : quotes.find((x) => Number(x.id) === Number(r.reply_to))
      const mentioned = deleted ? [] : list(r.mentions)
      return {
        id: Number(r.id),
        channelId: r.channel_id,
        sender: r.username ? publicUser({ id: r.sender_id, username: r.username, avatar: r.avatar, style: r.style }) : null,
        text: deleted ? '' : r.body,
        at: toMs(r.created_at),
        editedAt: deleted ? null : toMs(r.edited_at),
        deleted,
        replyTo: q ? { id: Number(q.id), sender: q.username ?? 'Someone who left', text: q.deleted_at ? 'Deleted message' : q.body.slice(0, 140) || (q.files ? 'Sent a file' : '') } : r.reply_to !== null ? { id: Number(r.reply_to), sender: '', text: 'Deleted message' } : null,
        reactions: deleted ? [] : reacted.filter((x) => Number(x.message_id) === Number(r.id)).map((x): Reaction => ({ emoji: x.emoji, count: x.n, mine: x.mine })),
        attachments: deleted ? [] : attached.filter((f) => Number(f.message_id) === Number(r.id)).map(attachmentOf),
        color: colors.find((x) => x.community_id === r.community_id && x.user_id === r.sender_id)?.color ?? null,
        mentionsMe: mentioned.includes(me),
        mentions: names.filter((n) => mentioned.includes(n.id)).map((n): [string, string] => [n.id, n.username]),
        nonce: r.sender_id === me ? r.nonce : null
      }
    })
  }
  const one = async (messageId: number): Promise<MessageRow | null> =>
    (await sql<MessageRow>`
      SELECT m.id, m.channel_id, m.community_id, m.sender_id, m.body, m.reply_to, m.created_at, m.edited_at, m.deleted_at, array_to_string(m.mentions, ',') AS mentions, m.nonce, p.username, p.avatar, p.style
      FROM vanity.channel_messages m LEFT JOIN vanity.profiles p ON p.id = m.sender_id WHERE m.id = ${messageId}`)[0] ?? null
  const messageId = (v: string): number => (/^\d{1,15}$/.test(v) ? Number(v) : fail(404, 'That message is gone.'))

  /**
   * A channel's messages, oldest first, for those who may see it. The newest page; `before` (a
   * message id) for older ones; or `since` (the `now` of the last answer) for whatever changed
   * after that: new messages, edits, deletions and reactions. Reading marks the channel as read.
   */
  app.get('/channels/:channelId/messages', async (c) => {
    const me = c.get('userId')
    const { channel } = await asChannelMember(c.req.param('channelId'), me)
    const num = (v: string | undefined): number | null => (v && /^\d{1,15}$/.test(v) ? Number(v) : null)
    const before = num(c.req.query('before'))
    const since = num(c.req.query('since'))
    const at = now()
    let rows: MessageRow[]
    let hasMore = false
    if (since !== null) {
      // A second of overlap, so nothing written at the same moment as the last look is missed.
      rows = await sql<MessageRow>`
        SELECT m.id, m.channel_id, m.community_id, m.sender_id, m.body, m.reply_to, m.created_at, m.edited_at, m.deleted_at, array_to_string(m.mentions, ',') AS mentions, m.nonce, p.username, p.avatar, p.style
        FROM vanity.channel_messages m LEFT JOIN vanity.profiles p ON p.id = m.sender_id
        WHERE m.channel_id = ${channel.id} AND m.changed_at > to_timestamp(${(since - 1000) / 1000}) ORDER BY m.id LIMIT 200`
    } else {
      const page = await sql<MessageRow>`
        SELECT m.id, m.channel_id, m.community_id, m.sender_id, m.body, m.reply_to, m.created_at, m.edited_at, m.deleted_at, array_to_string(m.mentions, ',') AS mentions, m.nonce, p.username, p.avatar, p.style
        FROM vanity.channel_messages m LEFT JOIN vanity.profiles p ON p.id = m.sender_id
        WHERE m.channel_id = ${channel.id} AND (${before}::bigint IS NULL OR m.id < ${before}::bigint) ORDER BY m.id DESC LIMIT ${PAGE + 1}`
      hasMore = page.length > PAGE
      rows = page.slice(0, PAGE).reverse()
    }
    if (before === null) {
      await sql`INSERT INTO vanity.channel_reads (channel_id, user_id, last_read) VALUES (${channel.id}, ${me}, COALESCE((SELECT MAX(id) FROM vanity.channel_messages WHERE channel_id = ${channel.id}), 0))
        ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read = GREATEST(vanity.channel_reads.last_read, excluded.last_read)`
    }
    const typing = await sql<{ username: string }>`
      SELECT p.username FROM vanity.channel_typing t JOIN vanity.profiles p ON p.id = t.user_id
      WHERE t.channel_id = ${channel.id} AND t.user_id <> ${me} AND t.at > to_timestamp(${(at - 7000) / 1000}) AND p.username IS NOT NULL ORDER BY t.at LIMIT 5`
    return c.json({ messages: await shape(rows, me), hasMore, now: at, typing: typing.map((t) => t.username) } satisfies MessagePage)
  })

  /** "I'm writing here": shown to the others for a few seconds. */
  app.post('/channels/:channelId/typing', async (c) => {
    const me = c.get('userId')
    const { channel, canPost } = await asChannelMember(c.req.param('channelId'), me)
    if (canPost) await sql`INSERT INTO vanity.channel_typing (channel_id, user_id, at) VALUES (${channel.id}, ${me}, to_timestamp(${ts()})) ON CONFLICT (channel_id, user_id) DO UPDATE SET at = excluded.at`
    return c.body(null, 204)
  })

  const textOf = (v: unknown, optional = false): string => {
    const clean = typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim() : ''
    if (!clean && !optional) fail(400, 'Write a message first.')
    if ([...clean].length > LIMITS.message) fail(400, `Messages can be up to ${LIMITS.message.toLocaleString('en-US')} characters.`)
    return clean
  }
  /** The accounts a message names with @, among the people in that community. */
  const mentionsIn = async (text: string, communityId: string): Promise<string[]> => {
    const names = mentionedNames(text)
    if (!names.length) return []
    return (await sql<{ id: string }>`SELECT p.id FROM vanity.profiles p JOIN vanity.community_members m ON m.user_id = p.id AND m.community_id = ${communityId} WHERE lower(p.username) = ANY(${names}::text[])`).map((r) => r.id)
  }
  const READ_ONLY = 'Only certain roles can write in this channel.'

  app.post('/channels/:channelId/messages', async (c) => {
    const me = c.get('userId')
    const { channel, canPost } = await asChannelMember(c.req.param('channelId'), me)
    if (!canPost) fail(403, READ_ONLY, 'read_only')
    canSpeak(me)
    const b = await body<{ text: string; replyTo: number | null; attachments: string[]; nonce: string }>(c)
    const fileIds = Array.isArray(b.attachments) ? [...new Set(b.attachments.filter((x): x is string => typeof x === 'string'))] : []
    if (fileIds.length > LIMITS.attachments) fail(400, `A message can carry up to ${LIMITS.attachments} files.`)
    const text = textOf(b.text, fileIds.length > 0)
    // The same message sent again (the first answer was lost on the way back): it is kept once.
    const nonce = typeof b.nonce === 'string' && /^[\w-]{8,40}$/.test(b.nonce) ? b.nonce : null
    const sentBefore = async (): Promise<MessageRow | null> => (nonce ? ((await sql<{ id: string | number }>`SELECT id FROM vanity.channel_messages WHERE sender_id = ${me} AND nonce = ${nonce}`)[0] ?? null) : null) as never
    const earlier = (await sentBefore()) as { id: string | number } | null
    if (earlier) return c.json({ message: (await shape([(await one(Number(earlier.id)))!], me))[0] })
    const t = Date.now()
    const s = sends.get(me)
    if (!s || s.reset < t) sends.set(me, { count: 1, reset: t + 60_000 })
    else if (++s.count > messageRateLimit) fail(429, "You're sending messages very fast. Wait a moment and try again.")
    // A reply must answer a message in this same channel.
    let replyTo: number | null = null
    if (typeof b.replyTo === 'number' && Number.isFinite(b.replyTo)) {
      const [target] = await sql`SELECT 1 FROM vanity.channel_messages WHERE id = ${Math.trunc(b.replyTo)} AND channel_id = ${channel.id}`
      if (target) replyTo = Math.trunc(b.replyTo)
    }
    // Files must be the sender's own, fully uploaded to this channel, and not on a message yet.
    if (fileIds.length) {
      const ok = await sql`SELECT 1 FROM vanity.channel_files WHERE id = ANY(${fileIds}::text[]) AND uploader_id = ${me} AND channel_id = ${channel.id} AND ready AND message_id IS NULL`
      if (ok.length !== fileIds.length) fail(400, "One of those files didn't finish uploading. Try attaching it again.", 'bad_attachment')
    }
    const mentions = await mentionsIn(text, channel.community_id)
    let made: { id: string | number } | undefined
    try {
      ;[made] = await sql<{ id: string | number }>`INSERT INTO vanity.channel_messages (channel_id, community_id, sender_id, body, reply_to, mentions, nonce, created_at, changed_at)
        VALUES (${channel.id}, ${channel.community_id}, ${me}, ${text}, ${replyTo}, ${mentions}::text[], ${nonce}, to_timestamp(${ts()}), to_timestamp(${ts()})) RETURNING id`
    } catch (e) {
      // Two copies of the same send arrived together: answer with the one that got in.
      const twin = (await sentBefore()) as { id: string | number } | null
      if (!twin) throw e
      return c.json({ message: (await shape([(await one(Number(twin.id)))!], me))[0] })
    }
    if (fileIds.length) await sql`UPDATE vanity.channel_files SET message_id = ${Number(made!.id)} WHERE id = ANY(${fileIds}::text[]) AND uploader_id = ${me} AND message_id IS NULL`
    await sql`INSERT INTO vanity.channel_reads (channel_id, user_id, last_read) VALUES (${channel.id}, ${me}, ${Number(made!.id)})
      ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read = GREATEST(vanity.channel_reads.last_read, excluded.last_read)`
    await sql`DELETE FROM vanity.channel_typing WHERE channel_id = ${channel.id} AND user_id = ${me}`
    return c.json({ message: (await shape([(await one(Number(made!.id)))!], me))[0] }, 201)
  })

  /** A message the caller may see (they may see its channel), with their role there. */
  async function seen(idText: string, me: string): Promise<{ m: MessageRow; role: Role }> {
    const m = await one(messageId(idText))
    const access = m ? await channelAccess(m.channel_id, me) : null
    if (!m || !access || m.deleted_at) fail(404, 'That message is gone.')
    return { m: m!, role: access!.role }
  }

  app.patch('/messages/:messageId', async (c) => {
    const me = c.get('userId')
    const { m } = await seen(c.req.param('messageId'), me)
    if (m.sender_id !== me) fail(403, 'You can only edit your own messages.')
    canSpeak(me)
    const [files_] = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM vanity.channel_files WHERE message_id = ${Number(m.id)}`
    const text = textOf((await body<{ text: string }>(c)).text, (files_?.n ?? 0) > 0)
    if (text !== m.body) {
      await sql`UPDATE vanity.channel_messages SET body = ${text}, mentions = ${await mentionsIn(text, m.community_id)}::text[], edited_at = to_timestamp(${ts()}), changed_at = to_timestamp(${ts()}) WHERE id = ${Number(m.id)}`
    }
    return c.json({ message: (await shape([(await one(Number(m.id)))!], me))[0] })
  })

  /** Your own message, or anyone's if your role may delete messages. It stays as "deleted" in its place. */
  app.delete('/messages/:messageId', async (c) => {
    const me = c.get('userId')
    const { m, role } = await seen(c.req.param('messageId'), me)
    if (m.sender_id !== me && !can(role, 'deleteMessages')) fail(403, 'You can only delete your own messages.')
    await sql`UPDATE vanity.channel_messages SET deleted_at = to_timestamp(${ts()}), changed_at = to_timestamp(${ts()}), body = '', mentions = '{}' WHERE id = ${Number(m.id)}`
    await sql`DELETE FROM vanity.channel_reactions WHERE message_id = ${Number(m.id)}`
    await removeFilesOf({ messageId: Number(m.id) })
    await sweepFiles()
    return c.body(null, 204)
  })

  /** One emoji (or a short run that makes one, like a flag or a skin tone). */
  const emojiOf = (v: string): string => {
    let emoji = ''
    try {
      emoji = decodeURIComponent(v)
    } catch {
      // not an emoji
    }
    if (!emoji || [...emoji].length > 8 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(emoji) || /[\p{L}\p{N}\s]/u.test(emoji.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, ''))) fail(400, 'React with an emoji.')
    return emoji
  }
  app.put('/messages/:messageId/reactions/:emoji', async (c) => {
    const me = c.get('userId')
    const { m } = await seen(c.req.param('messageId'), me)
    canSpeak(me)
    const emoji = emojiOf(c.req.param('emoji'))
    const kinds = await sql<{ emoji: string }>`SELECT DISTINCT emoji FROM vanity.channel_reactions WHERE message_id = ${Number(m.id)}`
    if (!kinds.some((k) => k.emoji === emoji) && kinds.length >= LIMITS.reactions) fail(409, `A message can have up to ${LIMITS.reactions} different reactions.`)
    const added = await sql`INSERT INTO vanity.channel_reactions (message_id, user_id, emoji, created_at) VALUES (${Number(m.id)}, ${me}, ${emoji}, to_timestamp(${ts()})) ON CONFLICT DO NOTHING RETURNING emoji`
    if (added.length) await sql`UPDATE vanity.channel_messages SET changed_at = to_timestamp(${ts()}) WHERE id = ${Number(m.id)}`
    return c.json({ message: (await shape([(await one(Number(m.id)))!], me))[0] })
  })
  app.delete('/messages/:messageId/reactions/:emoji', async (c) => {
    const me = c.get('userId')
    const { m } = await seen(c.req.param('messageId'), me)
    const gone = await sql`DELETE FROM vanity.channel_reactions WHERE message_id = ${Number(m.id)} AND user_id = ${me} AND emoji = ${emojiOf(c.req.param('emoji'))} RETURNING emoji`
    if (gone.length) await sql`UPDATE vanity.channel_messages SET changed_at = to_timestamp(${ts()}) WHERE id = ${Number(m.id)}`
    return c.json({ message: (await shape([(await one(Number(m.id)))!], me))[0] })
  })

  // ---- pictures and files ---------------------------------------------------------------
  // An app sends a file to this server a part at a time; the server passes each part on to
  // storage. Once every part is in, the file can be put on a message.

  const uploads = new Map<string, { count: number; reset: number }>()
  const NO_FILES = "Sending pictures and files isn't switched on yet."

  /** Starts an upload: says what the file is, and gets an id to send its parts to. */
  app.post('/channels/:channelId/uploads', async (c) => {
    const me = c.get('userId')
    const { channel, canPost } = await asChannelMember(c.req.param('channelId'), me)
    if (!canPost) fail(403, READ_ONLY, 'read_only')
    canSpeak(me)
    if (!files) fail(409, NO_FILES, 'no_files')
    const b = await body<{ name: string; size: number; type: string }>(c)
    const size = Math.trunc(Number(b.size))
    if (!Number.isFinite(size) || size < 1) fail(400, "That file is empty.")
    if (size > LIMITS.fileBytes) fail(400, `Files can be up to ${LIMITS.fileBytes / 1024 / 1024} MB.`, 'too_big')
    const name = tidyName(typeof b.name === 'string' ? b.name.replace(/[\\/:*?"<>|]+/g, ' ') : '', LIMITS.fileName) || 'file'
    const type = typeof b.type === 'string' && FILE_TYPE.test(b.type) ? b.type.toLowerCase() : 'application/octet-stream'
    const t = Date.now()
    const u = uploads.get(me)
    if (!u || u.reset < t) uploads.set(me, { count: 1, reset: t + 600_000 })
    else if (++u.count > 60) fail(429, "You're sending files very fast. Wait a few minutes and try again.")
    // Uploads that were started and never sent on a message are cleared away after an hour.
    await sql`INSERT INTO vanity.channel_files_gone (id, parts) SELECT id, parts FROM vanity.channel_files WHERE uploader_id = ${me} AND message_id IS NULL AND parts > 0 AND created_at < to_timestamp(${ts() - 3600}) ON CONFLICT DO NOTHING`
    await sql`DELETE FROM vanity.channel_files WHERE uploader_id = ${me} AND message_id IS NULL AND created_at < to_timestamp(${ts() - 3600})`
    await sweepFiles()
    const fileId = id() + id()
    await sql`INSERT INTO vanity.channel_files (id, token, channel_id, community_id, uploader_id, name, size, type, created_at)
      VALUES (${fileId}, ${randomBytes(24).toString('base64url')}, ${channel.id}, ${channel.community_id}, ${me}, ${name}, ${size}, ${type}, to_timestamp(${ts()}))`
    return c.json({ id: fileId, partSize: FILE_PART, parts: Math.ceil(size / FILE_PART) }, 201)
  })

  /** One part of a file, in order: { data: base64 }. The last part makes the file ready. */
  app.put('/uploads/:fileId/parts/:n', async (c) => {
    const me = c.get('userId')
    if (!files) fail(409, NO_FILES, 'no_files')
    const [f] = await sql<{ id: string; uploader_id: string; size: string | number; parts: number; received: string | number; ready: boolean; token: string; name: string; type: string }>`
      SELECT id, uploader_id, size, parts, received, ready, token, name, type FROM vanity.channel_files WHERE id = ${c.req.param('fileId')}`
    if (!f || f.uploader_id !== me) fail(404, 'That upload is gone. Attach the file again.')
    const n = Number(c.req.param('n'))
    const size = Number(f!.size)
    const received = Number(f!.received)
    // A part sent twice (its answer was lost): already have it.
    if (Number.isInteger(n) && n < f!.parts) return c.json({ received, ready: f!.ready, attachment: f!.ready ? attachmentOf(f!) : null })
    if (f!.ready || n !== f!.parts) fail(409, 'Those parts arrived out of order. Attach the file again.', 'out_of_order')
    const { data } = await body<{ data: string }>(c)
    const bytes = typeof data === 'string' && data.length <= FILE_PART * 1.4 ? Buffer.from(data, 'base64') : null
    const expected = Math.min(FILE_PART, size - received)
    if (!bytes || bytes.length !== expected) fail(400, "That part of the file didn't arrive whole. Try again.", 'bad_part')
    await files!.putPart(f!.id, n, new Uint8Array(bytes!))
    const ready = received + expected >= size
    // Only moves forward from the part it expected, so two copies of one part count once.
    const moved = await sql`UPDATE vanity.channel_files SET parts = ${n + 1}, received = ${received + expected}, ready = ${ready} WHERE id = ${f!.id} AND parts = ${n} RETURNING id`
    if (!moved.length) fail(409, 'Those parts arrived out of order. Attach the file again.', 'out_of_order')
    return c.json({ received: received + expected, ready, attachment: ready ? attachmentOf(f!) : null })
  })
  /** Takes back an upload that hasn't been sent on a message. */
  app.delete('/uploads/:fileId', async (c) => {
    const me = c.get('userId')
    await sql`INSERT INTO vanity.channel_files_gone (id, parts) SELECT id, parts FROM vanity.channel_files WHERE id = ${c.req.param('fileId')} AND uploader_id = ${me} AND message_id IS NULL AND parts > 0 ON CONFLICT DO NOTHING`
    await sql`DELETE FROM vanity.channel_files WHERE id = ${c.req.param('fileId')} AND uploader_id = ${me} AND message_id IS NULL`
    await sweepFiles()
    return c.body(null, 204)
  })

  // Downloads. No sign-in (a picture in a chat is fetched by the page, which can't send one):
  // the long random token in the address is what lets you in, and addresses are only given out
  // inside messages. Nothing here is ever run as a page: types that aren't a plain picture,
  // video or sound are sent as downloads.
  const pub = new Hono<Env>()
  pub.get('/:fileId/:token/:name?', async (c) => {
    const [f] = files ? await sql<{ id: string; token: string; name: string; size: string | number; type: string; parts: number; ready: boolean }>`SELECT id, token, name, size, type, parts, ready FROM vanity.channel_files WHERE id = ${c.req.param('fileId')}` : []
    const token = c.req.param('token')
    let same = !!f && f.ready && f.token.length === token.length
    if (same) for (let i = 0; i < token.length; i++) same = f.token.charCodeAt(i) === token.charCodeAt(i) && same
    if (!f || !same) return c.json({ error: 'Not found' }, 404)
    const stream = await files!.get(f.id, f.parts).catch(() => null)
    if (!stream) return c.json({ error: 'Not found' }, 404)
    const inline = INLINE.includes(f.type)
    return new Response(stream, {
      headers: {
        'content-type': inline ? f.type : 'application/octet-stream',
        'content-length': String(Number(f.size)),
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'cross-origin'
      }
    })
  })

  return { routes: app, files: pub, removeCommunity }
}
