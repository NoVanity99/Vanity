// "Channels": communities with rooms. Who can find and read what is the point of these tests.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Sql } from '../src/db'
import { ADMIN_USERNAMES } from '../src/roles'
import { schemaStatements } from '../src/schema'
import { tidyName, can, rankOf, TEMPLATES } from '../src/communityRules'

let app: ReturnType<typeof createApp>
let db: PGlite
let clock = 0
type U = { token: string; id: string }

async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json, text }
}
async function register(username: string): Promise<U> {
  const id = `id-${username.toLowerCase()}`
  expect((await call('PUT', '/me/username', `t:${id}`, { username })).status).toBe(200)
  return { token: `t:${id}`, id }
}
const create = async (u: U, name: string, visibility = 'open', template = 'scratch'): Promise<any> => {
  const r = await call('POST', '/communities', u.token, { name, visibility, template, description: `${name} description` })
  expect(r.status).toBe(201)
  return r.json.community
}
const invite = async (u: U, communityId: string, opts: object = {}): Promise<string> => (await call('POST', `/communities/${communityId}/invites`, u.token, opts)).json.invite.code
const join = (u: U, code: string) => call('POST', `/communities/invites/${code}/join`, u.token)
const say = async (u: U, channelId: string, text: string, replyTo?: number): Promise<any> => (await call('POST', `/communities/channels/${channelId}/messages`, u.token, { text, replyTo })).json?.message
const messages = async (u: U, channelId: string, q = ''): Promise<any> => (await call('GET', `/communities/channels/${channelId}/messages${q}`, u.token)).json

beforeEach(async () => {
  db = new PGlite()
  clock = 0
  const sql: Sql = async (strings, ...values) => (await db.query(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values)).rows as never
  app = createApp({ sql, verifyToken: async (t) => (t.startsWith('t:') ? { id: t.slice(2), email: null } : null), migrate: async () => { for (const st of schemaStatements()) await db.query(st) }, lookupRateLimit: 100_000, messageRateLimit: 10_000, now: () => Date.now() + clock })
})

describe('the rules shared with the app', () => {
  it('are the same file on both sides', () => {
    expect(readFileSync(new URL('../src/communityRules.ts', import.meta.url), 'utf8')).toBe(readFileSync(new URL('../../src/shared/communities.ts', import.meta.url), 'utf8'))
  })
  it('keep names as typed, apart from stray spaces', () => {
    expect(tidyName('  Late   Night Gaming 🎮  ', 50)).toBe('Late Night Gaming 🎮')
    expect(tidyName('General Chat', 50)).toBe('General Chat')
    expect(tidyName('   \n\t ', 50)).toBe('')
    expect(tidyName(42, 50)).toBe('')
    expect([...tidyName('🎮'.repeat(80), 50)].length).toBe(50)
  })
  it('rank the built-in roles', () => {
    expect([rankOf('owner'), rankOf('admin'), rankOf('mod'), rankOf('member'), rankOf(null)]).toEqual([3, 2, 1, 0, -1])
    expect([can('mod', 'kick'), can('mod', 'ban'), can('mod', 'manageChannels'), can('member', 'invite'), can('admin', 'manageRoles'), can(null, 'invite')]).toEqual([true, false, false, false, true, false])
  })
})

describe('creating', () => {
  it('makes the creator the owner and fills in the template', async () => {
    const a = await register('alice')
    const co = await create(a, '  Night   Owls 🦉 ', 'private', 'gaming')
    expect(co).toMatchObject({ name: 'Night Owls 🦉', visibility: 'private', role: 'owner', ownerId: a.id, members: 1, unread: 0 })
    const gaming = TEMPLATES.find((t) => t.id === 'gaming')!
    expect(co.categories.map((c: any) => c.name)).toEqual(gaming.categories.map((c) => c.name))
    expect(co.channels.map((c: any) => c.name)).toEqual(gaming.categories.flatMap((c) => c.channels))
    // Each channel sits in its template category.
    expect(co.channels.find((c: any) => c.name === 'Looking For Group').categoryId).toBe(co.categories.find((c: any) => c.name === 'Gaming').id)
    expect((await call('GET', '/communities', a.token)).json.communities.map((c: any) => c.name)).toEqual(['Night Owls 🦉'])
  })
  it('refuses empty, rude and nonsense input', async () => {
    const a = await register('alice')
    for (const b of [{ name: '   ' }, { name: 'x' }, { name: 'fuck this' }, { name: 'Fine', visibility: 'secret' }, { name: 'Fine', description: 'what a shit place' }, { name: 'Fine', icon: 'https://evil.example/x.png' }]) expect([JSON.stringify(b), (await call('POST', '/communities', a.token, { visibility: 'open', ...b })).status]).toEqual([JSON.stringify(b), 400])
    expect((await call('POST', '/communities', undefined, { name: 'Fine' })).status).toBe(401)
  })
})

describe('who can find and read what', () => {
  it('never shows a Hidden community to anyone outside it', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const open = await create(a, 'Open Arena')
    const priv = await create(a, 'Private Club', 'private')
    const hidden = await create(a, 'Secret Base', 'hidden')
    const secretChannel = hidden.channels[0].id
    await say(a, secretChannel, 'the launch codes')

    // Discover, with and without a search, by name, by description, by anything.
    const found = async (q = ''): Promise<string[]> => (await call('GET', `/communities/discover${q}`, b.token)).json.communities.map((c: any) => c.name).sort()
    expect(await found()).toEqual(['Open Arena', 'Private Club'])
    for (const q of ['?q=secret', '?q=Secret%20Base', '?q=base', '?q=description', '?q=%25', '?q=_', `?q=${hidden.id}`]) expect((await found(q)).includes('Secret Base')).toBe(false)
    // Asked for directly, it answers exactly like one that doesn't exist.
    const direct = await call('GET', `/communities/${hidden.id}`, b.token)
    const nothing = await call('GET', '/communities/does-not-exist', b.token)
    expect([direct.status, direct.text]).toEqual([nothing.status, nothing.text])
    expect(direct.status).toBe(404)
    // Every way in and every way to look is closed, with that same answer.
    for (const [m, path, body] of [
      ['POST', `/communities/${hidden.id}/join`],
      ['POST', `/communities/${hidden.id}/request`, { message: 'let me in' }],
      ['GET', `/communities/${hidden.id}/members`],
      ['GET', `/communities/${hidden.id}/invites`],
      ['GET', `/communities/${hidden.id}/requests`],
      ['GET', `/communities/${hidden.id}/bans`],
      ['POST', `/communities/${hidden.id}/invites`, {}],
      ['POST', `/communities/${hidden.id}/channels`, { name: 'mine now' }],
      ['PATCH', `/communities/${hidden.id}`, { visibility: 'open' }],
      ['POST', `/communities/${hidden.id}/leave`],
      ['PUT', `/communities/${hidden.id}/layout`, {}]
    ] as const) expect([path, (await call(m, path, b.token, body)).status]).toEqual([path, 404])
    expect((await call('DELETE', `/communities/${hidden.id}`, b.token)).status).toBe(404)
    expect((await call('GET', `/communities/${hidden.id}`, a.token)).status).toBe(200) // still there
    // Its channels and messages, by id.
    expect((await call('GET', `/communities/channels/${secretChannel}/messages`, b.token)).status).toBe(404)
    expect((await call('POST', `/communities/channels/${secretChannel}/messages`, b.token, { text: 'hi' })).status).toBe(404)
    const mid = (await messages(a, secretChannel)).messages[0].id
    for (const [m, path] of [['PATCH', `/communities/messages/${mid}`], ['DELETE', `/communities/messages/${mid}`], ['PUT', `/communities/messages/${mid}/reactions/${encodeURIComponent('👍')}`]] as const) expect((await call(m, path, b.token, { text: 'x' })).status).toBe(404)
    // It is not in Bob's own list, and not signed in means nothing at all.
    expect((await call('GET', '/communities', b.token)).json.communities).toEqual([])
    expect((await call('GET', '/communities/discover')).status).toBe(401)
    // The other two can be looked at as a card, with nothing inside.
    const card = (await call('GET', `/communities/${priv.id}`, b.token)).json
    expect(card).toMatchObject({ member: false, community: { name: 'Private Club', visibility: 'private', role: null } })
    expect(card.community.channels).toBeUndefined()
    expect(open.id).toBeTruthy()
  })

  it('lets nobody outside read messages in Private or Open communities either', async () => {
    const a = await register('alice')
    const b = await register('bob')
    for (const visibility of ['open', 'private']) {
      const co = await create(a, `The ${visibility} one`, visibility)
      await say(a, co.channels[0].id, 'members only')
      expect((await call('GET', `/communities/channels/${co.channels[0].id}/messages`, b.token)).status).toBe(404)
      expect((await call('GET', `/communities/${co.id}/members`, b.token)).status).toBe(404)
    }
  })

  it('makes a community disappear from Discover the moment it becomes Hidden', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const co = await create(a, 'Going Dark')
    const names = async (): Promise<string[]> => (await call('GET', '/communities/discover?q=dark', b.token)).json.communities.map((c: any) => c.name)
    expect(await names()).toEqual(['Going Dark'])
    expect((await call('PATCH', `/communities/${co.id}`, a.token, { visibility: 'hidden' })).json.community.visibility).toBe('hidden')
    expect(await names()).toEqual([])
    expect((await call('GET', `/communities/${co.id}`, b.token)).status).toBe(404)
  })
})

describe('joining', () => {
  it('Open: straight in. Private: ask, and be approved or denied', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const c = await register('cal')
    const open = await create(a, 'Open Arena')
    expect((await call('POST', `/communities/${open.id}/join`, b.token)).json.community).toMatchObject({ role: 'member', members: 2 })

    const priv = await create(a, 'Private Club', 'private')
    expect((await call('POST', `/communities/${priv.id}/join`, b.token)).json.code).toBe('needs_request')
    expect((await call('POST', `/communities/${priv.id}/request`, b.token, { message: 'hi, it is bob' })).status).toBe(204)
    expect((await call('POST', `/communities/${priv.id}/request`, c.token, {})).status).toBe(204)
    expect((await call('GET', '/communities/discover', b.token)).json.communities.find((x: any) => x.id === priv.id)).toMatchObject({ requested: true, role: null })
    // Only staff see and answer requests.
    expect((await call('GET', `/communities/${priv.id}/requests`, b.token)).status).toBe(404)
    const asked = (await call('GET', `/communities/${priv.id}/requests`, a.token)).json.requests
    expect(asked.map((r: any) => [r.user.username, r.message])).toEqual([['bob', 'hi, it is bob'], ['cal', '']])
    expect((await call('GET', `/communities/${priv.id}`, a.token)).json.community.pendingRequests).toBe(2)
    await call('POST', `/communities/${priv.id}/requests/${b.id}`, a.token, { approve: true })
    await call('POST', `/communities/${priv.id}/requests/${c.id}`, a.token, { approve: false })
    expect((await call('GET', `/communities/${priv.id}`, b.token)).json).toMatchObject({ member: true, community: { role: 'member' } })
    expect((await call('GET', `/communities/${priv.id}`, c.token)).json.member).toBe(false)
    expect((await call('GET', `/communities/${priv.id}/requests`, a.token)).json.requests).toEqual([])
  })

  it('invites get people into Hidden ones, and respect expiry, use limits and revoking', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const c = await register('cal')
    const d = await register('dee')
    const hidden = await create(a, 'Secret Base', 'hidden')
    const code = await invite(a, hidden.id, { maxUses: 1, expiresHours: 24 })
    expect(code).toMatch(/^[A-Z2-9]{8}$/)
    // The invite shows what it is for before joining (the only way a Hidden one is ever seen).
    expect((await call('GET', `/communities/invites/${code.toLowerCase()}`, b.token)).json.community).toMatchObject({ name: 'Secret Base', visibility: 'hidden', role: null })
    expect((await join(b, code)).json.community).toMatchObject({ role: 'member', name: 'Secret Base' })
    expect((await join(b, code)).status).toBe(200) // already in: nothing used up twice
    // One use only.
    expect((await join(c, code)).json.code).toBe('bad_invite')
    expect((await call('GET', `/communities/${hidden.id}`, c.token)).status).toBe(404)
    // Expired.
    const short = await invite(a, hidden.id, { expiresHours: 1 })
    clock += 2 * 3_600_000
    expect((await join(c, short)).status).toBe(404)
    // Revoked.
    const gone = await invite(a, hidden.id)
    await call('DELETE', `/communities/${hidden.id}/invites/${gone}`, a.token)
    expect((await join(c, gone)).status).toBe(404)
    expect((await join(c, 'NOTACODE')).status).toBe(404)
    // The last use, wanted by two people at the same moment: one gets in.
    const last = await invite(a, hidden.id, { maxUses: 1 })
    const both = await Promise.all([join(c, last), join(d, last)])
    expect(both.map((r) => r.status).sort()).toEqual([200, 404])
    // A plain member can't make invites; the list shows uses.
    expect((await call('POST', `/communities/${hidden.id}/invites`, b.token, {})).status).toBe(403)
    expect((await call('GET', `/communities/${hidden.id}/invites`, a.token)).json.invites.find((i: any) => i.code === code)).toMatchObject({ uses: 1, maxUses: 1, createdBy: 'alice' })
    for (const bad of [{ maxUses: 0 }, { expiresHours: -1 }, { maxUses: 'lots' }]) expect((await call('POST', `/communities/${hidden.id}/invites`, a.token, bad)).status).toBe(400)
  })

  it('leaving, and an owner who can only leave by handing it over or deleting it', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const co = await create(a, 'Open Arena')
    await call('POST', `/communities/${co.id}/join`, b.token)
    expect((await call('POST', `/communities/${co.id}/leave`, a.token)).json.code).toBe('owner_cant_leave')
    expect((await call('POST', `/communities/${co.id}/transfer`, b.token, { userId: b.id })).status).toBe(403)
    expect((await call('POST', `/communities/${co.id}/transfer`, a.token, { userId: 'id-nobody' })).status).toBe(400)
    expect((await call('POST', `/communities/${co.id}/transfer`, a.token, { userId: b.id })).status).toBe(204)
    expect((await call('GET', `/communities/${co.id}`, b.token)).json.community).toMatchObject({ role: 'owner', ownerId: b.id })
    expect((await call('GET', `/communities/${co.id}`, a.token)).json.community.role).toBe('admin')
    expect((await call('POST', `/communities/${co.id}/leave`, a.token)).status).toBe(204)
    expect((await call('DELETE', `/communities/${co.id}`, a.token)).status).toBe(404)
    // The last person leaving closes it; deleting is the owner's.
    expect((await call('POST', `/communities/${co.id}/leave`, b.token)).status).toBe(204)
    expect((await call('GET', '/communities/discover', a.token)).json.communities).toEqual([])
  })
})

describe('roles', () => {
  it('each role can only do what it may, and only to roles below it', async () => {
    const [a, ad, mo, me, x] = [await register('alice'), await register('addie'), await register('moe'), await register('mem'), await register('xan')]
    const co = await create(a, 'Open Arena')
    for (const u of [ad, mo, me, x]) await call('POST', `/communities/${co.id}/join`, u.token)
    const setRole = (by: U, who: U, role: string) => call('PATCH', `/communities/${co.id}/members/${who.id}`, by.token, { role })
    expect((await setRole(a, ad, 'admin')).status).toBe(204)
    expect((await setRole(a, mo, 'mod')).status).toBe(204)
    // Nobody makes a second owner, raises someone to their own level, or touches an equal or a superior.
    expect((await setRole(a, ad, 'owner')).status).toBe(400)
    expect((await setRole(ad, me, 'admin')).status).toBe(403)
    expect((await setRole(ad, a, 'member')).status).toBe(403)
    expect((await setRole(mo, me, 'mod')).status).toBe(403) // moderators don't manage roles
    expect((await setRole(me, x, 'mod')).status).toBe(403)
    expect((await setRole(ad, me, 'mod')).status).toBe(204)
    expect((await setRole(ad, me, 'member')).status).toBe(204)

    const tries = async (u: U): Promise<Record<string, number>> => ({
      rename: (await call('PATCH', `/communities/${co.id}`, u.token, { name: `Arena by ${u.id.slice(3)}` })).status,
      visibility: (await call('PATCH', `/communities/${co.id}`, u.token, { visibility: 'open' })).status,
      channel: (await call('POST', `/communities/${co.id}/channels`, u.token, { name: 'New One' })).status,
      invite: (await call('POST', `/communities/${co.id}/invites`, u.token, {})).status,
      requests: (await call('GET', `/communities/${co.id}/requests`, u.token)).status,
      bans: (await call('GET', `/communities/${co.id}/bans`, u.token)).status,
      delete: (await call('DELETE', `/communities/does-not-matter`, u.token)).status
    })
    expect(await tries(me)).toMatchObject({ rename: 403, visibility: 403, channel: 403, invite: 403, requests: 403, bans: 403 })
    expect(await tries(mo)).toMatchObject({ rename: 403, visibility: 403, channel: 403, invite: 201, requests: 200, bans: 403 })
    expect(await tries(ad)).toMatchObject({ rename: 200, visibility: 403, channel: 201, invite: 201, requests: 200, bans: 200 })
    expect(await tries(a)).toMatchObject({ rename: 200, visibility: 200, channel: 201, invite: 201, requests: 200, bans: 200 })

    // Kicking and banning.
    expect((await call('DELETE', `/communities/${co.id}/members/${ad.id}`, mo.token)).status).toBe(403) // a superior
    expect((await call('DELETE', `/communities/${co.id}/members/${mo.id}`, mo.token)).status).toBe(400) // yourself
    expect((await call('DELETE', `/communities/${co.id}/members/${x.id}`, me.token)).status).toBe(403)
    expect((await call('DELETE', `/communities/${co.id}/members/${x.id}`, mo.token)).status).toBe(204)
    expect((await call('POST', `/communities/${co.id}/join`, x.token)).status).toBe(200) // kicked people can come back
    expect((await call('POST', `/communities/${co.id}/bans`, mo.token, { userId: x.id })).status).toBe(403) // moderators kick, they don't ban
    expect((await call('POST', `/communities/${co.id}/bans`, ad.token, { userId: x.id, reason: 'spamming' })).status).toBe(204)
    // Banned: out, gone from Discover, and no way back in by joining, asking or an invite.
    const code = await invite(a, co.id)
    expect((await call('POST', `/communities/${co.id}/join`, x.token)).json.code).toBe('banned_here')
    expect((await join(x, code)).json.code).toBe('banned_here')
    expect((await call('GET', '/communities/discover', x.token)).json.communities).toEqual([])
    expect((await call('GET', `/communities/${co.id}/bans`, a.token)).json.bans.map((b: any) => [b.user.username, b.reason])).toEqual([['xan', 'spamming']])
    await call('DELETE', `/communities/${co.id}/bans/${x.id}`, a.token)
    expect((await call('POST', `/communities/${co.id}/join`, x.token)).status).toBe(200)
    // The member list, staff first.
    const members = (await call('GET', `/communities/${co.id}/members`, me.token)).json.members
    expect(members.map((m: any) => [m.user.username, m.role])).toEqual([['alice', 'owner'], ['addie', 'admin'], ['moe', 'mod'], ['mem', 'member'], ['xan', 'member']])
  })

  it('lets a Vanity admin remove any community, and nobody else', async () => {
    ADMIN_USERNAMES.push('SiteBoss')
    let boss: U
    try {
      boss = await register('SiteBoss')
    } finally {
      ADMIN_USERNAMES.pop()
    }
    const a = await register('alice')
    const hidden = await create(a, 'Secret Base', 'hidden')
    // Even they can't read it; but they can take it down.
    expect((await call('GET', `/communities/${hidden.id}`, boss.token)).status).toBe(404)
    expect((await call('DELETE', `/communities/${hidden.id}`, boss.token)).status).toBe(204)
    expect((await call('GET', '/communities', a.token)).json.communities).toEqual([])
  })
})

describe('channels (rooms) and categories', () => {
  it('keeps names as typed, and lets staff add, rename, move and delete', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const co = await create(a, 'Open Arena', 'open', 'scratch')
    await call('POST', `/communities/${co.id}/join`, b.token)
    const general = co.channels[0]
    const made = (await call('POST', `/communities/${co.id}/channels`, a.token, { name: '  Late   Night Gaming 🎮 ', categoryId: co.categories[0].id })).json.channel
    expect(made).toMatchObject({ name: 'Late Night Gaming 🎮', categoryId: co.categories[0].id })
    expect((await call('POST', `/communities/${co.id}/channels`, a.token, { name: '    ' })).status).toBe(400)
    expect((await call('POST', `/communities/${co.id}/channels`, a.token, { name: 'x'.repeat(80) })).json.channel.name).toHaveLength(50)
    expect((await call('POST', `/communities/${co.id}/channels`, b.token, { name: 'Mine' })).status).toBe(403)
    expect((await call('PATCH', `/communities/channels/${made.id}`, b.token, { name: 'Hacked' })).status).toBe(403)
    expect((await call('PATCH', `/communities/channels/${made.id}`, a.token, { name: 'After Dark 🌙' })).status).toBe(204)

    const cat = (await call('POST', `/communities/${co.id}/categories`, a.token, { name: 'Off Topic' })).json.category
    // Move things around in one go; ids from elsewhere are ignored.
    const other = await create(a, 'Other Place')
    const laid = (await call('PUT', `/communities/${co.id}/layout`, a.token, { uncategorized: [], categories: [{ id: cat.id, channels: [made.id, other.channels[0].id, 'made-up'] }, { id: co.categories[0].id, channels: [general.id] }, { id: other.categories[0].id, channels: [] }] })).json.community
    expect(laid.categories.map((c: any) => c.name)).toEqual(['Off Topic', 'General'])
    expect(laid.channels.filter((c: any) => c.categoryId === cat.id).map((c: any) => c.name)).toEqual(['After Dark 🌙'])
    expect((await call('GET', `/communities/${other.id}`, a.token)).json.community.channels[0].categoryId).toBe(other.categories[0].id)

    // Deleting a category keeps its channels; deleting a channel takes its messages with it.
    await say(a, made.id, 'hello')
    await call('DELETE', `/communities/categories/${cat.id}`, a.token)
    const after = (await call('GET', `/communities/${co.id}`, a.token)).json.community
    expect(after.channels.find((c: any) => c.id === made.id).categoryId).toBeNull()
    expect((await call('DELETE', `/communities/channels/${made.id}`, a.token)).status).toBe(204)
    expect((await call('GET', `/communities/channels/${made.id}/messages`, a.token)).status).toBe(404)
  })
})

describe('messages', () => {
  it('sends, pages, replies, edits and deletes, showing current usernames', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const co = await create(a, 'Open Arena')
    await call('POST', `/communities/${co.id}/join`, b.token)
    const ch = co.channels[0].id
    for (let i = 1; i <= 55; i++) await say(i % 2 ? a : b, ch, `message ${i}`)
    const first = await messages(b, ch)
    expect(first.messages).toHaveLength(50)
    expect(first.hasMore).toBe(true)
    expect([first.messages[0].text, first.messages.at(-1).text]).toEqual(['message 6', 'message 55'])
    const older = await messages(b, ch, `?before=${first.messages[0].id}`)
    expect(older.messages.map((m: any) => m.text)).toEqual(['message 1', 'message 2', 'message 3', 'message 4', 'message 5'])
    expect(older.hasMore).toBe(false)

    const target = first.messages.at(-1) // alice's "message 55"
    const reply = await say(b, ch, 'replying to you', target.id)
    expect(reply.replyTo).toEqual({ id: target.id, sender: 'alice', text: 'message 55' })
    // A reply can't point at a message in another channel.
    const elsewhere = (await call('POST', `/communities/${co.id}/channels`, a.token, { name: 'Other' })).json.channel
    expect((await say(b, elsewhere.id, 'sneaky', target.id)).replyTo).toBeNull()

    // Alice changes her username: every message of hers shows the new one.
    clock += 1000
    await call('PUT', '/me/username', a.token, { username: 'alicia' })
    const again = await messages(b, ch)
    expect(again.messages.find((m: any) => m.id === target.id).sender.username).toBe('alicia')
    expect(again.messages.find((m: any) => m.id === reply.id).replyTo.sender).toBe('alicia')

    // Edit and delete: your own; a moderator may delete others'.
    expect((await call('PATCH', `/communities/messages/${target.id}`, b.token, { text: 'hacked' })).status).toBe(403)
    const edited = (await call('PATCH', `/communities/messages/${target.id}`, a.token, { text: 'message 55, fixed' })).json.message
    expect(edited).toMatchObject({ text: 'message 55, fixed', deleted: false })
    expect(edited.editedAt).toBeGreaterThan(0)
    expect((await call('DELETE', `/communities/messages/${target.id}`, b.token)).status).toBe(403)
    await call('PATCH', `/communities/${co.id}/members/${b.id}`, a.token, { role: 'mod' })
    expect((await call('DELETE', `/communities/messages/${target.id}`, b.token)).status).toBe(204)
    const gone = (await messages(a, ch)).messages.find((m: any) => m.id === target.id)
    expect(gone).toMatchObject({ deleted: true, text: '', reactions: [] })
    // The reply shows that what it answered was deleted, and the text is really gone from the database.
    expect((await messages(a, ch)).messages.find((m: any) => m.id === reply.id).replyTo.text).toBe('Deleted message')
    expect((await db.query<{ body: string }>('SELECT body FROM vanity.channel_messages WHERE id = $1', [target.id])).rows[0].body).toBe('')
    expect((await call('PATCH', `/communities/messages/${target.id}`, a.token, { text: 'back' })).status).toBe(404)
    for (const text of ['', '   ', 'x'.repeat(2001), 42]) expect((await call('POST', `/communities/channels/${ch}/messages`, a.token, { text })).status).toBe(400)
  })

  it('tells an open app what changed since it last looked: new, edited, deleted, reacted', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const co = await create(a, 'Open Arena')
    await call('POST', `/communities/${co.id}/join`, b.token)
    const ch = co.channels[0].id
    const m1 = await say(a, ch, 'one')
    const m2 = await say(a, ch, 'two')
    const seen = await messages(b, ch)
    clock += 5000
    // (The first look after loading may repeat the last second's messages; the app merges by id.)
    const quiet = await messages(b, ch, `?since=${seen.now}`)
    clock += 5000
    expect((await messages(b, ch, `?since=${quiet.now}`)).messages).toEqual([])
    const m3 = await say(a, ch, 'three')
    await call('PATCH', `/communities/messages/${m1.id}`, a.token, { text: 'one!' })
    await call('PUT', `/communities/messages/${m2.id}/reactions/${encodeURIComponent('🔥')}`, a.token)
    const changed = (await messages(b, ch, `?since=${quiet.now}`)).messages
    expect(changed.map((m: any) => [m.id, m.text, m.reactions.length])).toEqual([[m1.id, 'one!', 0], [m2.id, 'two', 1], [m3.id, 'three', 0]])
    clock += 5000
    const later = (await messages(b, ch)).now
    clock += 5000
    await call('DELETE', `/communities/messages/${m2.id}`, a.token)
    expect((await messages(b, ch, `?since=${later}`)).messages.map((m: any) => [m.id, m.deleted])).toEqual([[m2.id, true]])
  })

  it('reactions: add, count, remove, emoji only', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const co = await create(a, 'Open Arena')
    await call('POST', `/communities/${co.id}/join`, b.token)
    const m = await say(a, co.channels[0].id, 'react to me')
    const react = (u: U, emoji: string, method = 'PUT') => call(method, `/communities/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, u.token)
    await react(a, '👍')
    await react(b, '👍')
    await react(b, '👍') // twice is once
    expect((await react(b, '🎮')).json.message.reactions).toEqual([{ emoji: '👍', count: 2, mine: true }, { emoji: '🎮', count: 1, mine: true }])
    expect((await messages(a, co.channels[0].id)).messages[0].reactions).toEqual([{ emoji: '👍', count: 2, mine: true }, { emoji: '🎮', count: 1, mine: false }])
    expect((await react(b, '👍', 'DELETE')).json.message.reactions).toEqual([{ emoji: '👍', count: 1, mine: false }, { emoji: '🎮', count: 1, mine: true }])
    for (const bad of ['lol', '<b>', 'a', '👍 hello', '']) expect([bad, (await react(a, bad)).status === 200]).toEqual([bad, false])
    expect((await react(a, '🇬🇧')).status).toBe(200)
  })

  it('counts unread per channel and per community, and remembers where you were', async () => {
    const a = await register('alice')
    const b = await register('bob')
    const co = await create(a, 'Open Arena', 'open', 'friends')
    const [c1, c2] = co.channels
    await say(a, c1.id, 'before bob joined')
    await call('POST', `/communities/${co.id}/join`, b.token)
    const mine = async (): Promise<any> => (await call('GET', '/communities', b.token)).json
    // What was there before you joined isn't "unread".
    expect((await mine()).communities[0].unread).toBe(0)
    await say(a, c1.id, 'one')
    await say(a, c1.id, 'two')
    const del = await say(a, c2.id, 'three')
    await say(b, co.channels[2].id, 'my own never count')
    expect((await mine()).communities[0].unread).toBe(3)
    const unread = async (): Promise<Record<string, number>> => Object.fromEntries((await call('GET', `/communities/${co.id}`, b.token)).json.community.channels.map((c: any) => [c.name, c.unread]))
    expect(await unread()).toMatchObject({ General: 2, 'Plans 📅': 1 })
    await call('DELETE', `/communities/messages/${del.id}`, a.token) // a deleted message isn't unread
    expect(await unread()).toMatchObject({ General: 2, 'Plans 📅': 0 })
    await messages(b, c1.id) // opening a channel reads it
    expect(await unread()).toMatchObject({ General: 0 })
    expect((await mine()).communities[0].unread).toBe(0)

    // Where you last were comes back on any PC.
    expect((await mine()).last).toEqual({ communityId: null, channelId: null })
    expect((await call('PUT', '/communities/last-place', b.token, { communityId: co.id, channelId: c2.id })).status).toBe(204)
    expect((await mine()).last).toEqual({ communityId: co.id, channelId: c2.id })
  })

  it('a timed-out or banned account cannot post or react; everyone else carries on', async () => {
    ADMIN_USERNAMES.push('SiteBoss')
    let boss: U
    try {
      boss = await register('SiteBoss')
    } finally {
      ADMIN_USERNAMES.pop()
    }
    const a = await register('alice')
    const co = await create(a, 'Open Arena')
    const m = await say(a, co.channels[0].id, 'hi')
    await call('POST', `/admin/users/${a.id}/timeout`, boss.token, { minutes: 30 })
    expect((await call('POST', `/communities/channels/${co.channels[0].id}/messages`, a.token, { text: 'x' })).json.code).toBe('timed_out')
    expect((await call('PUT', `/communities/messages/${m.id}/reactions/${encodeURIComponent('👍')}`, a.token)).json.code).toBe('timed_out')
    expect((await call('POST', '/communities', a.token, { name: 'Another', visibility: 'open' })).json.code).toBe('timed_out')
    expect((await messages(a, co.channels[0].id)).messages).toHaveLength(1) // reading is fine
  })
})
