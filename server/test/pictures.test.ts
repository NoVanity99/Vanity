// Profile pictures and Channel icons are read out of the database once, then served from memory:
// the apps ask for lists of people every few seconds, and re-reading the pictures each time moved
// gigabytes a month.
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Sql } from '../src/db'
import { schemaStatements } from '../src/schema'

let app: ReturnType<typeof createApp>
let queries: { text: string; bytes: number }[] = []
const PIC = (fill: string): string => `data:image/png;base64,${fill.repeat(20_000)}`

async function call(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}
const register = async (username: string): Promise<{ token: string; id: string }> => {
  const id = `id-${username.toLowerCase()}`
  expect((await call('PUT', '/me/username', `t:${id}`, { username })).status).toBe(200)
  return { token: `t:${id}`, id }
}
/** How much data left the database since `from`. */
const bytesSince = (from: number): number => queries.slice(from).reduce((sum, q) => sum + q.bytes, 0)

beforeEach(async () => {
  const db = new PGlite()
  queries = []
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    const rows = (await db.query(text, values)).rows
    queries.push({ text, bytes: JSON.stringify(rows).length })
    return rows as never
  }
  app = createApp({
    sql,
    verifyToken: async (t) => (t.startsWith('t:') ? { id: t.slice(2), email: null } : null),
    migrate: async () => {
      for (const st of schemaStatements()) await db.query(st)
    },
    lookupRateLimit: 100_000
  })
})

describe('pictures come out of the database once', () => {
  it('a friends list refreshed over and over reads each picture a single time', async () => {
    const [ann, ben] = [await register('Ann'), await register('Ben')]
    expect((await call('PUT', '/me/profile', ben.token, { avatar: PIC('A') })).status).toBe(200)
    await call('POST', '/friends/requests', ann.token, { username: 'Ben' })
    await call('POST', `/friends/requests/${ann.id}/accept`, ben.token)

    const first = await call('GET', '/friends', ann.token)
    expect(first.json.friends[0].avatar).toBe(PIC('A'))
    const after = queries.length
    for (let i = 0; i < 20; i++) expect((await call('GET', '/friends', ann.token)).json.friends[0].avatar).toBe(PIC('A'))
    // Twenty more refreshes: the 20,000-character picture never left the database again.
    expect(bytesSince(after)).toBeLessThan(20 * 3000)
    expect(queries.slice(after).some((q) => /AS data/.test(q.text))).toBe(false)

    // A new picture shows at once (it has a new reference), and is itself then read only once.
    await call('PUT', '/me/profile', ben.token, { avatar: PIC('B') })
    expect((await call('GET', '/friends', ann.token)).json.friends[0].avatar).toBe(PIC('B'))
    const again = queries.length
    expect((await call('GET', '/friends', ann.token)).json.friends[0].avatar).toBe(PIC('B'))
    expect(queries.slice(again).some((q) => /AS data/.test(q.text))).toBe(false)
    // Removing it shows as no picture.
    await call('PUT', '/me/profile', ben.token, { avatar: null })
    expect((await call('GET', '/friends', ann.token)).json.friends[0].avatar).toBeNull()
    expect((await call('GET', '/me', ben.token)).json.user.avatar).toBeNull()
  })

  it('the same goes for Channel icons, member lists and messages', async () => {
    const [ann, ben] = [await register('Ann'), await register('Ben')]
    await call('PUT', '/me/profile', ben.token, { avatar: PIC('C') })
    const co = (await call('POST', '/communities', ann.token, { name: 'Club', template: 'scratch', icon: PIC('D') })).json.community
    expect(co.icon).toBe(PIC('D'))
    await call('POST', `/communities/${co.id}/join`, ben.token)
    const ch = co.channels[0].id
    await call('POST', `/communities/channels/${ch}/messages`, ben.token, { text: 'hi' })
    const look = async (): Promise<void> => {
      expect((await call('GET', '/communities', ann.token)).json.communities[0].icon).toBe(PIC('D'))
      expect((await call('GET', `/communities/${co.id}`, ann.token)).json.community.icon).toBe(PIC('D'))
      expect((await call('GET', `/communities/${co.id}/members`, ann.token)).json.members.find((m: any) => m.user.id === ben.id).user.avatar).toBe(PIC('C'))
      expect((await call('GET', `/communities/channels/${ch}/messages`, ann.token)).json.messages[0].sender.avatar).toBe(PIC('C'))
      expect((await call('GET', '/communities/discover', ben.token)).json.communities[0].icon).toBe(PIC('D'))
    }
    // Warm up, then count.
    await look()
    const after = queries.length
    for (let i = 0; i < 10; i++) await look()
    expect(bytesSince(after)).toBeLessThan(10 * 5 * 4000)
    expect(queries.slice(after).some((q) => /AS data/.test(q.text))).toBe(false)
  })
})
