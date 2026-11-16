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
import { fakeSteam, KEY } from './fake-steam'

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
// A pretend Steam with two accounts: "gabelogannewell" (public) and "shy_one" (game details private).
const steam = fakeSteam([
  {
    steamId: '76561197960287930',
    name: 'Rabscuttle',
    vanity: 'gabelogannewell',
    games: Array.from({ length: 142 }, (_, i) => ({ appid: 1000 + i, name: `Game ${i + 1}`, playtime_forever: i % 3 === 0 ? 0 : 60 * (i + 1), playtime_2weeks: i < 4 ? 30 : 0, rtime_last_played: 1_790_000_000 - i * 86_400 })),
    achievements: Object.fromEntries(Array.from({ length: 142 }, (_, i) => [1000 + i, Array.from({ length: 12 }, (_, n) => ({ apiname: `A${n}`, achieved: (n < (i % 13) ? 1 : 0) as 0 | 1 }))]))
  },
  { steamId: '76561198000000001', name: 'Shy', vanity: 'shy_one', private: true }
])

const api = createApp({
  sql,
  steamApiKey: process.env.NO_STEAM ? '' : KEY,
  // GIF search answers like KLIPY does (KLIPY_FAKE=1), since tests can't reach it.
  klipyKey: process.env.KLIPY_FAKE ? 'local-test-key' : '',
  fetchFn: async (url: string, init?: RequestInit) => {
    if (url.includes('api.klipy.com')) {
      const q = new URL(url).searchParams.get('q') ?? 'trending'
      const data = Array.from({ length: 6 }, (_, i) => ({ id: `${q}-${i}`, type: 'gif', file: { md: { gif: { url: `https://static.klipy.com/test/${q}-${i}.gif`, width: 320, height: 180 } }, sm: { gif: { url: `https://static.klipy.com/test/${q}-${i}-sm.gif`, width: 160, height: 90 } } } }))
      return new Response(JSON.stringify({ result: true, data: { data, current_page: 1, has_next: false } }), { status: 200 })
    }
    return steam.fetchFn(url, init)
  },
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
