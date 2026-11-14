// The real Vanity server on an in-process Postgres, for tests that live in the app's own test suite.
// Tokens are "t:<user id>" (Neon Auth itself is covered by test/app-client.test.ts).
import { PGlite } from '@electric-sql/pglite'
import { createApp } from '../../src/app'
import type { Sql } from '../../src/db'
import { schemaStatements } from '../../src/schema'

export async function testBackend(): Promise<{ fetchFn: (url: string, init?: RequestInit) => Promise<Response>; setDown(down: boolean): void; requests(): number }> {
  const db = new PGlite()
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  const app = createApp({
    sql,
    verifyToken: async (token) => (token.startsWith('t:') ? { id: token.slice(2), email: `${token.slice(2)}@example.com` } : null),
    migrate: async () => {
      for (const statement of schemaStatements()) await db.query(statement)
    },
    syncRateLimit: 10_000,
    lookupRateLimit: 10_000
  })
  let down = false
  let count = 0
  return {
    fetchFn: async (url, init) => {
      if (down) throw new TypeError('fetch failed')
      count++
      return app.request(url.replace(/^https?:\/\/[^/]+/, ''), init)
    },
    setDown: (v) => (down = v),
    requests: () => count
  }
}
