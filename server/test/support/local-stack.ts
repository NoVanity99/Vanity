// A local playground for the account features: a stand-in for Neon Auth plus the real Vanity
// server on an in-memory database, on one port. Used to try the app's sign-in screens by hand:
//
//   npx tsx test/support/local-stack.ts            (in server/)
//   MAIN_VITE_NEON_AUTH_URL=http://127.0.0.1:8791/neondb/auth MAIN_VITE_VANITY_BACKEND_URL=http://127.0.0.1:8791/api npm run dev    (in the repo root)
//
// Password-reset codes are printed here instead of being emailed. Nothing is kept after it stops.
import { serve } from '@hono/node-server'
import { PGlite } from '@electric-sql/pglite'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { emailOTP, jwt } from 'better-auth/plugins'
import { createLocalJWKSet, type JSONWebKeySet } from 'jose'
import { Hono } from 'hono'
import { createApp } from '../../src/app'
import { neonAuthVerifier } from '../../src/auth'
import type { Sql } from '../../src/db'
import { schemaStatements } from '../../src/schema'

const port = Number(process.env.PORT) || 8791
const base = `http://127.0.0.1:${port}`

const auth = betterAuth({
  baseURL: `${base}/neondb/auth`,
  basePath: '/neondb/auth',
  secret: 'local-playground-only-9f3k2j5h8d1s',
  database: memoryAdapter({ user: [], session: [], account: [], verification: [], jwks: [] }),
  emailAndPassword: { enabled: true },
  session: process.env.SESSION_SECONDS ? { expiresIn: Number(process.env.SESSION_SECONDS) } : undefined,
  trustedOrigins: ['http://localhost:*'],
  advanced: { cookiePrefix: 'neon-auth' },
  plugins: [jwt({ jwks: { jwksPath: '/.well-known/jwks.json' } }), emailOTP({ sendVerificationOTP: async ({ email, otp }) => console.log(`[email to ${email}] Your Vanity code is ${otp}`) })]
})

const db = new PGlite()
const sql: Sql = async (strings, ...values) => {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
  return (await db.query(text, values)).rows as never
}
let keys: ReturnType<typeof createLocalJWKSet> | null = null
const api = createApp({
  sql,
  verifyToken: neonAuthVerifier(async (header, token) =>
    (keys ??= createLocalJWKSet((await (await auth.handler(new Request(`${base}/neondb/auth/.well-known/jwks.json`))).json()) as JSONWebKeySet))(header, token)
  ),
  migrate: async () => {
    for (const statement of schemaStatements()) await db.query(statement)
  }
})

const root = new Hono()
root.all('/neondb/auth/*', (c) => auth.handler(c.req.raw))
root.all('*', (c) => api.fetch(c.req.raw))
serve({ fetch: root.fetch, port, hostname: '127.0.0.1' }, () => console.log(`Local Vanity stack on ${base}  (auth: /neondb/auth, server: /api)`))
