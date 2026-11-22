// Channels, part 2: custom roles and restricted channels, @mentions, typing, sending twice,
// pictures and files, direct invites and the admin tools. Who can see what is the point again.
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Sql } from '../src/db'
import { FILE_PART } from '../src/files'
import { ADMIN_USERNAMES } from '../src/roles'
import { schemaStatements } from '../src/schema'
import { fileSize, mentionedNames } from '../src/communityRules'
import { workerFileStore } from './support/file-store'
import { handle } from '../files-worker/worker.js'

let app: ReturnType<typeof createApp>
let db: PGlite
let clock = 0
let bucket: Map<string, Uint8Array>
type U = { token: string; id: string }

async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any; res: Response }> {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const copy = res.clone()
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json, res: copy }
}
async function register(username: string): Promise<U> {
  const id = `id-${username.toLowerCase()}`
  expect((await call('PUT', '/me/username', `t:${id}`, { username })).status).toBe(200)
  return { token: `t:${id}`, id }
}
const create = async (u: U, name: string, visibility = 'open', template = 'scratch'): Promise<any> => (await call('POST', '/communities', u.token, { name, visibility, template })).json.community
const joinOpen = (u: U, id: string) => call('POST', `/communities/${id}/join`, u.token)
const say = (u: U, channelId: string, text: string, extra: object = {}) => call('POST', `/communities/channels/${channelId}/messages`, u.token, { text, ...extra })
const messages = async (u: U, channelId: string, q = ''): Promise<any> => (await call('GET', `/communities/channels/${channelId}/messages${q}`, u.token)).json
const detail = async (u: U, id: string): Promise<any> => (await call('GET', `/communities/${id}`, u.token)).json.community
const befriend = async (a: U, b: U, bName: string): Promise<void> => {
  expect((await call('POST', '/friends/requests', a.token, { username: bName })).status).toBeLessThan(300)
  const incoming = (await call('GET', '/friends', b.token)).json
  const req = (incoming.incoming ?? incoming.requests ?? []).find((r: any) => (r.user?.id ?? r.id) === a.id)
  expect((await call('POST', `/friends/requests/${req.user?.id ?? req.id}/accept`, b.token)).status).toBeLessThan(300)
}
/** Uploads bytes the way the app does: start, then a part at a time. */
async function upload(u: U, channelId: string, name: string, type: string, bytes: Uint8Array): Promise<any> {
  const start = await call('POST', `/communities/channels/${channelId}/uploads`, u.token, { name, type, size: bytes.length })
  if (start.status !== 201) return start
  let last: any = null
  for (let n = 0; n < start.json.parts; n++) {
    last = await call('PUT', `/communities/uploads/${start.json.id}/parts/${n}`, u.token, { data: Buffer.from(bytes.subarray(n * FILE_PART, (n + 1) * FILE_PART)).toString('base64') })
    expect(last.status).toBe(200)
  }
  return { status: 201, id: start.json.id, attachment: last.json.attachment, json: last.json }
}

beforeEach(async () => {
  db = new PGlite()
  clock = 0
  const sql: Sql = async (strings, ...values) => (await db.query(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values)).rows as never
  const files = workerFileStore()
  bucket = files.bucket
  app = createApp({ sql, verifyToken: async (t) => (t.startsWith('t:') ? { id: t.slice(2), email: null } : null), migrate: async () => { for (const st of schemaStatements()) await db.query(st) }, lookupRateLimit: 100_000, messageRateLimit: 10_000, now: () => Date.now() + clock, fileStore: files.store })
})

describe('custom roles and restricted channels', () => {
  it('only the owner makes roles; a restricted channel is invisible to everyone without the role', async () => {
    const [ann, ben, cat] = [await register('Ann'), await register('Ben'), await register('Cat')]
    const co = await create(ann, 'Club')
    await joinOpen(ben, co.id)
    await joinOpen(cat, co.id)
    await call('PATCH', `/communities/${co.id}/members/${ben.id}`, ann.token, { role: 'admin' })
    // An admin can't create roles; the owner can.
    expect((await call('POST', `/communities/${co.id}/roles`, ben.token, { name: 'VIP', color: '#ef4444' })).status).toBe(403)
    const vip = (await call('POST', `/communities/${co.id}/roles`, ann.token, { name: '  VIP  ', color: '#ef4444' })).json.role
    expect(vip).toMatchObject({ name: 'VIP', color: '#ef4444' })
    expect((await call('POST', `/communities/${co.id}/roles`, ann.token, { name: 'Odd', color: 'javascript:alert(1)' })).json.role.color).toBe('#94a3b8')

    const secret = (await call('POST', `/communities/${co.id}/channels`, ann.token, { name: 'VIP Lounge' })).json.channel
    expect((await call('PATCH', `/communities/channels/${secret.id}`, ann.token, { restricted: 'view', roleIds: [vip.id, 'made-up'] })).status).toBe(204)
    const secretMsg = (await say(ann, secret.id, 'vip only @Cat')).json.message

    // Cat (a plain member without the role): it isn't in her list, her unread counts, or reachable.
    const catView = await detail(cat, co.id)
    expect(catView.channels.map((c: any) => c.name)).not.toContain('VIP Lounge')
    expect(catView.unread).toBe(0)
    expect(catView.mentions).toBe(0)
    expect((await call('GET', '/communities', cat.token)).json.communities[0]).toMatchObject({ unread: 0, mentions: 0 })
    expect((await call('GET', `/communities/channels/${secret.id}/messages`, cat.token)).status).toBe(404)
    expect((await say(cat, secret.id, 'let me in')).status).toBe(404)
    expect((await call('POST', `/communities/channels/${secret.id}/typing`, cat.token)).status).toBe(404)
    expect((await call('POST', `/communities/channels/${secret.id}/uploads`, cat.token, { name: 'a.png', type: 'image/png', size: 10 })).status).toBe(404)
    expect((await call('PUT', `/communities/messages/${secretMsg.id}/reactions/${encodeURIComponent('👍')}`, cat.token)).status).toBe(404)
    expect((await call('DELETE', `/communities/messages/${secretMsg.id}`, cat.token)).status).toBe(404)

    // Ben (an admin) sees it without holding the role, and gives Cat the role.
    expect((await detail(ben, co.id)).channels.find((c: any) => c.id === secret.id)).toMatchObject({ restricted: 'view', roleIds: [vip.id], canPost: true })
    expect((await call('PUT', `/communities/${co.id}/members/${cat.id}/roles`, cat.token, { roleIds: [vip.id] })).status).toBe(403)
    expect((await call('PUT', `/communities/${co.id}/members/${cat.id}/roles`, ben.token, { roleIds: [vip.id, 'nope'] })).json.roleIds).toEqual([vip.id])
    const now = await detail(cat, co.id)
    expect(now.myRoleIds).toEqual([vip.id])
    expect(now.channels.find((c: any) => c.id === secret.id)).toMatchObject({ unread: 1, mentions: 1, canPost: true })
    expect(now).toMatchObject({ unread: 1, mentions: 1 })
    const seen = await messages(cat, secret.id)
    expect(seen.messages[0]).toMatchObject({ text: 'vip only @Cat', mentionsMe: true })
    // Her messages carry the role's colour; members are listed with their roles.
    expect((await say(cat, secret.id, 'thanks')).json.message.color).toBe('#ef4444')
    expect((await call('GET', `/communities/${co.id}/members`, ann.token)).json.members.find((m: any) => m.user.id === cat.id).roleIds).toEqual([vip.id])

    // Deleting the role shuts her out again.
    expect((await call('DELETE', `/communities/roles/${vip.id}`, ben.token)).status).toBe(403)
    expect((await call('DELETE', `/communities/roles/${vip.id}`, ann.token)).status).toBe(204)
    expect((await call('GET', `/communities/channels/${secret.id}/messages`, cat.token)).status).toBe(404)
    expect((await detail(cat, co.id)).roles).toHaveLength(1)
  })

  it('a read-only channel: everyone reads, only the roles (and staff) write', async () => {
    const [ann, cat] = [await register('Ann'), await register('Cat')]
    const co = await create(ann, 'Club')
    await joinOpen(cat, co.id)
    const news = co.channels[0]
    const role = (await call('POST', `/communities/${co.id}/roles`, ann.token, { name: 'Writers' })).json.role
    await call('PATCH', `/communities/channels/${news.id}`, ann.token, { restricted: 'post', roleIds: [role.id] })
    await say(ann, news.id, 'big news')
    expect((await messages(cat, news.id)).messages).toHaveLength(1)
    expect((await detail(cat, co.id)).channels[0]).toMatchObject({ restricted: 'post', canPost: false })
    const refused = await say(cat, news.id, 'me too')
    expect(refused.status).toBe(403)
    expect(refused.json.code).toBe('read_only')
    await call('PUT', `/communities/${co.id}/members/${cat.id}/roles`, ann.token, { roleIds: [role.id] })
    expect((await say(cat, news.id, 'me too')).status).toBe(201)
  })
})

describe('mentions, typing and sending twice', () => {
  it('finds @names like usernames, not email addresses', () => {
    expect(mentionedNames('hi @Ann and @ben_2! mail me at x@example.com, @@nope @ab')).toEqual(['ann', 'ben_2'])
    expect(fileSize(900)).toBe('900 B')
    expect(fileSize(3_355_443)).toBe('3.2 MB')
  })

  it('a mention counts for the person named, follows a rename, and only works for members', async () => {
    const [ann, ben, out] = [await register('Ann'), await register('Ben'), await register('Outsider')]
    const co = await create(ann, 'Club')
    await joinOpen(ben, co.id)
    const ch = co.channels[0].id
    const m = (await say(ann, ch, 'hey @ben and @Outsider and @nobody_here')).json.message
    expect(m.mentions).toEqual([[ben.id, 'Ben']])
    expect((await detail(ben, co.id)).channels[0]).toMatchObject({ unread: 1, mentions: 1 })
    expect((await call('GET', '/communities', ben.token)).json.communities[0].mentions).toBe(1)
    expect((await messages(ben, ch)).messages[0].mentionsMe).toBe(true)
    expect((await detail(ben, co.id)).channels[0]).toMatchObject({ unread: 0, mentions: 0 })
    // Editing the mention away removes it.
    const edited = (await call('PATCH', `/communities/messages/${m.id}`, ann.token, { text: 'hey everyone' })).json.message
    expect(edited.mentions).toEqual([])
    void out
  })

  it('shows who is typing for a few seconds, and not to themselves', async () => {
    const [ann, ben] = [await register('Ann'), await register('Ben')]
    const co = await create(ann, 'Club')
    await joinOpen(ben, co.id)
    const ch = co.channels[0].id
    expect((await call('POST', `/communities/channels/${ch}/typing`, ben.token)).status).toBe(204)
    expect((await messages(ann, ch)).typing).toEqual(['Ben'])
    expect((await messages(ben, ch)).typing).toEqual([])
    clock += 8000
    expect((await messages(ann, ch)).typing).toEqual([])
    // Sending clears it at once.
    await call('POST', `/communities/channels/${ch}/typing`, ben.token)
    await say(ben, ch, 'done')
    expect((await messages(ann, ch)).typing).toEqual([])
  })

  it('a message sent again with the same tag is kept once', async () => {
    const ann = await register('Ann')
    const co = await create(ann, 'Club')
    const ch = co.channels[0].id
    const first = await say(ann, ch, 'hello', { nonce: 'abc12345-xyz' })
    const again = await say(ann, ch, 'hello', { nonce: 'abc12345-xyz' })
    expect(first.status).toBe(201)
    expect(again.status).toBe(200)
    expect(again.json.message.id).toBe(first.json.message.id)
    const both = await Promise.all([say(ann, ch, 'twin', { nonce: 'twin-twin-twin' }), say(ann, ch, 'twin', { nonce: 'twin-twin-twin' })])
    expect(both[0].json.message.id).toBe(both[1].json.message.id)
    expect((await messages(ann, ch)).messages.map((m: any) => m.text)).toEqual(['hello', 'twin'])
    expect((await messages(ann, ch)).messages[0].nonce).toBe('abc12345-xyz')
  })
})

describe('pictures and files', () => {
  const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 251)

  it('a file goes up in parts, rides on a message, comes back whole, and is removed with the message', async () => {
    const [ann, ben, out] = [await register('Ann'), await register('Ben'), await register('Outsider')]
    const co = await create(ann, 'Club', 'private')
    const ch = co.channels[0].id
    const data = bytes(FILE_PART * 2 + 12345)
    const up = await upload(ann, ch, 'holiday: photo?.png', 'image/png', data)
    expect(up.attachment).toMatchObject({ name: 'holiday photo .png', size: data.length, type: 'image/png' })
    expect(bucket.size).toBe(3)
    // Not on a message yet: nobody else can use it.
    expect((await say(ann, ch, '', { attachments: ['made-up-id'] })).status).toBe(400)
    const sent = await say(ann, ch, '', { attachments: [up.id] })
    expect(sent.status).toBe(201)
    expect(sent.json.message.attachments).toHaveLength(1)
    expect((await say(ann, ch, 'again', { attachments: [up.id] })).status).toBe(400)

    // The address works without a sign-in (a picture is fetched by the page) and returns the same bytes.
    const path = sent.json.message.attachments[0].path
    const got = await app.request(path)
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(got.headers.get('content-disposition')).toContain('inline')
    expect(got.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(data)
    expect((await app.request('/api' + path)).status).toBe(200)
    // A guessed token, or the id alone, gets nothing.
    expect((await app.request(path.replace(/\/[^/]+\/[^/]+$/, '/wrongtoken/x.png'))).status).toBe(404)
    // The address is only ever handed out inside the channel's messages, which outsiders can't read.
    expect((await call('GET', `/communities/channels/${ch}/messages`, out.token)).status).toBe(404)
    expect((await call('POST', `/communities/channels/${ch}/uploads`, out.token, { name: 'x', type: 'image/png', size: 5 })).status).toBe(404)
    void ben

    // Deleting the message removes the bytes from storage, and the address stops working.
    expect((await call('DELETE', `/communities/messages/${sent.json.message.id}`, ann.token)).status).toBe(204)
    expect(bucket.size).toBe(0)
    expect((await app.request(path)).status).toBe(404)
  })

  it('anything that could run as a page is sent as a download', async () => {
    const ann = await register('Ann')
    const co = await create(ann, 'Club')
    const ch = co.channels[0].id
    const up = await upload(ann, ch, 'page.html', 'text/html', new TextEncoder().encode('<script>alert(1)</script>'))
    const sent = (await say(ann, ch, 'look', { attachments: [up.id] })).json.message
    const got = await app.request(sent.attachments[0].path)
    expect(got.headers.get('content-type')).toBe('application/octet-stream')
    expect(got.headers.get('content-disposition')).toContain('attachment')
    expect(got.headers.get('content-security-policy')).toContain('sandbox')
    const svg = await upload(ann, ch, 'pic.svg', 'image/svg+xml', new TextEncoder().encode('<svg onload="alert(1)"/>'))
    const sent2 = (await say(ann, ch, '', { attachments: [svg.id] })).json.message
    expect((await app.request(sent2.attachments[0].path)).headers.get('content-disposition')).toContain('attachment')
  })

  it('checks size, order and ownership', async () => {
    const [ann, ben] = [await register('Ann'), await register('Ben')]
    const co = await create(ann, 'Club')
    await joinOpen(ben, co.id)
    const ch = co.channels[0].id
    expect((await call('POST', `/communities/channels/${ch}/uploads`, ann.token, { name: 'big.zip', type: 'application/zip', size: 25 * 1024 * 1024 + 1 })).json.code).toBe('too_big')
    expect((await call('POST', `/communities/channels/${ch}/uploads`, ann.token, { name: 'none', type: 'x', size: 0 })).status).toBe(400)
    const start = (await call('POST', `/communities/channels/${ch}/uploads`, ann.token, { name: 'a.bin', type: 'weird', size: FILE_PART + 10 })).json
    const part = (b: Uint8Array) => ({ data: Buffer.from(b).toString('base64') })
    // Someone else's upload, a part out of order, a part of the wrong size.
    expect((await call('PUT', `/communities/uploads/${start.id}/parts/0`, ben.token, part(bytes(FILE_PART)))).status).toBe(404)
    expect((await call('PUT', `/communities/uploads/${start.id}/parts/1`, ann.token, part(bytes(10)))).status).toBe(409)
    expect((await call('PUT', `/communities/uploads/${start.id}/parts/0`, ann.token, part(bytes(500)))).status).toBe(400)
    expect((await call('PUT', `/communities/uploads/${start.id}/parts/0`, ann.token, part(bytes(FILE_PART)))).json).toMatchObject({ received: FILE_PART, ready: false })
    // The same part again (its answer was lost): counted once.
    expect((await call('PUT', `/communities/uploads/${start.id}/parts/0`, ann.token, part(bytes(FILE_PART)))).json).toMatchObject({ received: FILE_PART, ready: false })
    // Not finished: can't be sent yet. Ben can't send Ann's file either.
    expect((await say(ann, ch, 'x', { attachments: [start.id] })).status).toBe(400)
    const done = (await call('PUT', `/communities/uploads/${start.id}/parts/1`, ann.token, part(bytes(10)))).json
    expect(done.ready).toBe(true)
    expect(done.attachment.type).toBe('application/octet-stream')
    expect((await say(ben, ch, 'mine now', { attachments: [start.id] })).status).toBe(400)
    // Taking an unsent upload back removes its bytes.
    expect(bucket.size).toBe(2)
    expect((await call('DELETE', `/communities/uploads/${start.id}`, ann.token)).status).toBe(204)
    expect(bucket.size).toBe(0)
  })

  it('deleting a channel or the whole community removes its files from storage', async () => {
    const ann = await register('Ann')
    const co = await create(ann, 'Club')
    const extra = (await call('POST', `/communities/${co.id}/channels`, ann.token, { name: 'Pics' })).json.channel
    for (const ch of [co.channels[0].id, extra.id]) {
      const up = await upload(ann, ch, 'a.png', 'image/png', bytes(2000))
      await say(ann, ch, '', { attachments: [up.id] })
    }
    expect(bucket.size).toBe(2)
    await call('DELETE', `/communities/channels/${extra.id}`, ann.token)
    expect(bucket.size).toBe(1)
    await call('DELETE', `/communities/${co.id}`, ann.token)
    expect(bucket.size).toBe(0)
  })

  it('without a file store, Channels still work and uploads say so', async () => {
    const sql: Sql = async (strings, ...values) => (await db.query(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), ''), values)).rows as never
    app = createApp({ sql, verifyToken: async (t) => (t.startsWith('t:') ? { id: t.slice(2), email: null } : null), migrate: async () => { for (const st of schemaStatements()) await db.query(st) }, fileStore: null })
    const ann = await register('Ann')
    const co = await create(ann, 'Club')
    expect(co.filesEnabled).toBe(false)
    expect((await call('POST', `/communities/channels/${co.channels[0].id}/uploads`, ann.token, { name: 'a.png', type: 'image/png', size: 10 })).json.code).toBe('no_files')
    expect((await say(ann, co.channels[0].id, 'still works')).status).toBe(201)
  })

  it('the storage worker answers only to the secret address', async () => {
    const env = { KEY: 's'.repeat(40), BUCKET: { put: async () => {}, get: async () => null, delete: async () => {} } }
    expect((await handle(new Request(`http://w/${'x'.repeat(40)}/o/abcdefgh12?parts=1`), env)).status).toBe(404)
    expect((await handle(new Request('http://w/'), env)).status).toBe(404)
    expect((await handle(new Request(`http://w/${env.KEY}/o/abcdefgh12/0`, { method: 'PUT', body: new Uint8Array(3 * 1024 * 1024) }), env)).status).toBe(413)
    expect((await handle(new Request(`http://w/${env.KEY}/o/abcdefgh12/0`, { method: 'PUT', body: new Uint8Array(10) }), env)).status).toBe(204)
    expect((await handle(new Request(`http://w/${env.KEY}/o/../../etc?parts=1`), env)).status).toBe(404)
  })
})

describe('direct invites', () => {
  it('a friend can be invited straight into a Hidden community; strangers cannot be', async () => {
    const [ann, ben, cat] = [await register('Ann'), await register('Ben'), await register('Cat')]
    const co = await create(ann, 'Ghost Town', 'hidden')
    await befriend(ann, ben, 'Ben')
    expect((await call('POST', `/communities/${co.id}/direct-invites`, ann.token, { userId: cat.id })).status).toBe(400)
    expect((await call('POST', `/communities/${co.id}/direct-invites`, ann.token, { userId: ben.id })).status).toBe(204)
    expect((await call('GET', `/communities/${co.id}/direct-invites`, ann.token)).json.invited).toEqual([ben.id])
    // Ben sees the invitation (and so the Hidden community's card); Cat sees nothing.
    const mine = (await call('GET', '/communities/direct-invites', ben.token)).json.invites
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ by: 'Ann', community: { name: 'Ghost Town', visibility: 'hidden' } })
    expect((await call('GET', '/communities/direct-invites', cat.token)).json.invites).toEqual([])
    expect((await call('POST', `/communities/direct-invites/${co.id}`, cat.token, { accept: true })).status).toBe(404)
    // Still hidden to Ben until he accepts.
    expect((await call('GET', `/communities/${co.id}`, ben.token)).status).toBe(404)
    const joined = await call('POST', `/communities/direct-invites/${co.id}`, ben.token, { accept: true })
    expect(joined.json.community.role).toBe('member')
    expect((await call('GET', '/communities/direct-invites', ben.token)).json.invites).toEqual([])
    // A plain member can't invite.
    await befriend(ben, cat, 'Cat')
    expect((await call('POST', `/communities/${co.id}/direct-invites`, ben.token, { userId: cat.id })).status).toBe(403)
  })

  it('declining removes it, and a banned person is not let in by an old invitation', async () => {
    const [ann, ben] = [await register('Ann'), await register('Ben')]
    const co = await create(ann, 'Club', 'private')
    await befriend(ann, ben, 'Ben')
    await call('POST', `/communities/${co.id}/direct-invites`, ann.token, { userId: ben.id })
    expect((await call('POST', `/communities/direct-invites/${co.id}`, ben.token, { accept: false })).status).toBe(204)
    expect((await call('GET', '/communities/direct-invites', ben.token)).json.invites).toEqual([])
    await call('POST', `/communities/${co.id}/direct-invites`, ann.token, { userId: ben.id })
    await call('POST', `/communities/${co.id}/bans`, ann.token, { userId: ben.id })
    expect((await call('GET', '/communities/direct-invites', ben.token)).json.invites).toEqual([])
    expect((await call('POST', `/communities/direct-invites/${co.id}`, ben.token, { accept: true })).status).toBe(403)
  })
})

describe('Vanity admins and Channels', () => {
  it('only Vanity admins list every community (Hidden ones too) and can remove one', async () => {
    ADMIN_USERNAMES.push('Boss')
    try {
      const [boss, ann, ben] = [await register('Boss'), await register('Ann'), await register('Ben')]
      const hidden = await create(ann, 'Ghost Town', 'hidden')
      await create(ann, 'Open Place')
      expect((await call('GET', '/admin/communities', ben.token)).status).toBe(403)
      expect((await call('DELETE', `/admin/communities/${hidden.id}`, ben.token)).status).toBe(403)
      const all = (await call('GET', '/admin/communities', boss.token)).json.communities
      expect(all.map((c: any) => c.name).sort()).toEqual(['Ghost Town', 'Open Place'])
      expect(all.find((c: any) => c.name === 'Ghost Town')).toMatchObject({ visibility: 'hidden', owner: 'Ann', members: 1 })
      expect((await call('GET', '/admin/communities?q=ghost', boss.token)).json.communities).toHaveLength(1)
      expect((await call('DELETE', `/admin/communities/${hidden.id}`, boss.token)).status).toBe(204)
      expect((await call('GET', `/communities/${hidden.id}`, ann.token)).status).toBe(404)
      expect((await call('GET', '/admin/log', boss.token)).json.entries?.[0]?.action ?? (await call('GET', '/admin/log', boss.token)).json.log?.[0]?.action).toBe('delete channel')
    } finally {
      ADMIN_USERNAMES.pop()
    }
  })
})
