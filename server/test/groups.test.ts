import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import * as shared from '../../src/shared/groups'
import { createApp } from '../src/app'
import type { VerifyToken } from '../src/auth'
import type { Sql } from '../src/db'
import * as server from '../src/groups'
import { parseKlipy } from '../src/groups'
import { schemaStatements } from '../src/schema'

const verifyToken: VerifyToken = async (token) => (token.startsWith('t:') ? { id: token.slice(2), email: `${token.slice(2)}@example.com` } : null)

let app: ReturnType<typeof createApp>
let klipyCalls: string[] = []
let clock = Date.UTC(2026, 10, 16, 12)

async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}
async function register(name: string): Promise<{ token: string; id: string; name: string }> {
  const id = `id-${name}`
  expect((await call('PUT', '/me/username', `t:${id}`, { username: name })).status).toBe(200)
  return { token: `t:${id}`, id, name }
}
async function befriend(a: { token: string; id: string }, b: { token: string; id: string; name: string }): Promise<void> {
  await call('POST', '/friends/requests', a.token, { username: b.name })
  await call('POST', `/friends/requests/${a.id}/accept`, b.token)
}

const KLIPY_ANSWER = {
  result: true,
  data: {
    data: [
      { id: 101, slug: 'wave', type: 'gif', file: { hd: { gif: { url: 'https://static.klipy.com/ii/hd/wave.gif', width: 498, height: 280 } }, md: { gif: { url: 'https://static.klipy.com/ii/md/wave.gif', width: 320, height: 180 } }, sm: { gif: { url: 'https://static.klipy.com/ii/sm/wave.gif', width: 220, height: 124 } } } },
      { id: 102, type: 'ad' },
      { id: 103, type: 'gif', file: { md: { gif: { url: 'https://evil.example/x.gif' } } } }
    ],
    current_page: 1,
    has_next: true
  }
}

function make(klipyKey: string): void {
  const db = new PGlite()
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  klipyCalls = []
  app = createApp({
    sql,
    verifyToken,
    migrate: async () => {
      for (const s of schemaStatements()) await db.query(s)
    },
    lookupRateLimit: 1000,
    klipyKey,
    fetchFn: async (url: string) => {
      klipyCalls.push(url)
      return new Response(JSON.stringify(KLIPY_ANSWER), { status: 200 })
    },
    now: () => (clock += 1000)
  })
}

beforeEach(() => make('test-key'))

describe('group chats', () => {
  it('are made with friends, show everyone, and pass messages around with unread counts', async () => {
    const ann = await register('ann')
    const ben = await register('ben')
    const cal = await register('cal')
    await befriend(ann, ben)
    await befriend(ann, cal)
    const made = await call('POST', '/groups', ann.token, { name: '  Raid   night ', memberIds: [ben.id, cal.id, ann.id] })
    expect(made.status).toBe(201)
    expect(made.json.group).toMatchObject({ name: 'Raid night', ownerId: ann.id, unread: 0, lastMessage: null })
    expect(made.json.group.members.map((m: any) => m.username)).toEqual(['ann', 'ben', 'cal'])
    const id = made.json.group.id

    expect((await call('POST', `/groups/${id}/messages`, ann.token, { text: 'tonight at 8?' })).status).toBe(201)
    await call('POST', `/groups/${id}/messages`, ben.token, { text: "I'm in" })
    // Cal sees both as unread, with the newest as the preview.
    const calList = (await call('GET', '/groups', cal.token)).json.groups
    expect(calList[0]).toMatchObject({ id, unread: 2, lastMessage: { text: "I'm in", senderName: 'ben' } })
    const page = (await call('GET', `/groups/${id}/messages`, cal.token)).json
    expect(page.messages.map((m: any) => m.text)).toEqual(['tonight at 8?', "I'm in"])
    expect((await call('GET', '/groups', cal.token)).json.groups[0].unread).toBe(0)
    // Ann's own message doesn't count for her; Ben's does.
    expect((await call('GET', '/groups', ann.token)).json.groups[0].unread).toBe(1)
    // Only newer ones.
    const after = page.messages.at(-1).id
    await call('POST', `/groups/${id}/messages`, cal.token, { text: 'same' })
    expect((await call('GET', `/groups/${id}/messages?after=${after}`, ann.token)).json.messages.map((m: any) => m.text)).toEqual(['same'])
  })

  it('only lets members in, and only friends be added', async () => {
    const ann = await register('ann')
    const ben = await register('ben')
    const eve = await register('eve')
    await befriend(ann, ben)
    expect((await call('POST', '/groups', ann.token, { memberIds: [eve.id] })).status).toBe(403)
    expect((await call('POST', '/groups', ann.token, { memberIds: [] })).status).toBe(400)
    const id = (await call('POST', '/groups', ann.token, { memberIds: [ben.id] })).json.group.id
    // Named after the people in it when no name is given.
    expect((await call('GET', '/groups', ann.token)).json.groups[0].name).toBe('ann, ben')
    expect((await call('GET', `/groups/${id}/messages`, eve.token)).status).toBe(404)
    expect((await call('POST', `/groups/${id}/messages`, eve.token, { text: 'hi' })).status).toBe(404)
    expect((await call('POST', `/groups/${id}/members`, ann.token, { userId: eve.id })).status).toBe(403)
    await befriend(ann, eve)
    expect((await call('POST', `/groups/${id}/members`, ann.token, { userId: eve.id })).json.group.members).toHaveLength(3)
    expect((await call('PATCH', `/groups/${id}`, eve.token, { name: 'Squad' })).json.group.name).toBe('Squad')
  })

  it('passes the group on when its maker leaves, and only they remove people', async () => {
    const ann = await register('ann')
    const ben = await register('ben')
    const cal = await register('cal')
    await befriend(ann, ben)
    await befriend(ann, cal)
    const id = (await call('POST', '/groups', ann.token, { memberIds: [ben.id, cal.id] })).json.group.id
    expect((await call('DELETE', `/groups/${id}/members/${cal.id}`, ben.token)).status).toBe(403)
    expect((await call('DELETE', `/groups/${id}/members/me`, ann.token)).status).toBe(204)
    expect((await call('GET', '/groups', ben.token)).json.groups[0]).toMatchObject({ ownerId: ben.id })
    expect((await call('DELETE', `/groups/${id}/members/${cal.id}`, ben.token)).status).toBe(204)
    await call('DELETE', `/groups/${id}/members/me`, ben.token)
    expect((await call('GET', '/groups', ben.token)).json.groups).toEqual([])
  })
})

describe('GIFs', () => {
  it('searches KLIPY through the server, keeping the key there, and only passes on KLIPY addresses', async () => {
    const ann = await register('ann')
    const r = await call('GET', '/gifs?q=wave', ann.token)
    expect(r.json.gifs).toEqual([{ id: '101', url: 'https://static.klipy.com/ii/md/wave.gif', preview: 'https://static.klipy.com/ii/sm/wave.gif', width: 320, height: 180 }])
    expect(klipyCalls[0]).toMatch(/^https:\/\/api\.klipy\.com\/api\/v1\/test-key\/gifs\/search\?/)
    expect(klipyCalls[0]).toContain('q=wave')
    expect(klipyCalls[0]).not.toContain('id-ann') // a hashed id, never the account id
    expect(JSON.stringify(r.json)).not.toContain('test-key')
    await call('GET', '/gifs', ann.token)
    expect(klipyCalls[1]).toContain('/gifs/trending')
  })

  it('says when search is off, and GIFs in messages must be KLIPY or uploaded ones', async () => {
    make('')
    const ann = await register('ann')
    const ben = await register('ben')
    await befriend(ann, ben)
    const off = await call('GET', '/gifs?q=x', ann.token)
    expect([off.status, off.json.code]).toEqual([404, 'gifs_off'])
    expect((await call('POST', `/friends/${ben.id}/messages`, ann.token, { text: '[gif] https://static.klipy.com/ii/md/wave.gif' })).status).toBe(201)
    expect((await call('POST', `/friends/${ben.id}/messages`, ann.token, { text: '[gif] https://evil.example/x.gif' })).status).toBe(400)
  })

  it('keeps GIFs uploaded from a device, and nothing else', async () => {
    const ann = await register('ann')
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100, 1)]).toString('base64')
    const up = await call('POST', '/media', ann.token, { data: gif })
    expect(up.status).toBe(201)
    expect(up.json.id).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect((await call('GET', `/media/${up.json.id}`, ann.token)).json).toEqual({ mime: 'image/gif', data: gif })
    expect((await call('GET', `/media/${up.json.id}`)).status).toBe(401)
    expect((await call('POST', '/media', ann.token, { data: Buffer.from('\x89PNG\r\n').toString('base64') })).status).toBe(400)
    expect((await call('POST', '/media', ann.token, { data: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(3 * 1024 * 1024)]).toString('base64') })).status).toBe(400)
  })
})

describe('shared rules', () => {
  it('match the app', () => {
    for (const k of ['MAX_GROUP_SIZE', 'MAX_GROUP_NAME', 'MAX_GIF_BYTES'] as const) expect([k, server[k]]).toEqual([k, shared[k]])
    for (const text of ['[gif] https://static.klipy.com/a.gif', '[gif] media:abcdefghijklmnopqrstuv', '[gif] https://evil.example/a.gif', 'hello']) {
      expect([text, server.validGifText(text)]).toEqual([text, text.startsWith('[gif]') ? shared.gifOf(text) !== null : true])
    }
  })
  it('reads KLIPY answers in other shapes too', () => {
    expect(parseKlipy({ data: [{ id: 1, file: { sm: { webp: { url: 'https://static.klipy.com/s.webp' } } } }] })[0].url).toBe('https://static.klipy.com/s.webp')
    expect(parseKlipy(null)).toEqual([])
  })
})
