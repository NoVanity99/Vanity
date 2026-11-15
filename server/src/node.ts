// Local / any-Node-host entry: `npm run dev` (watches) or `npm start`.
// DATABASE_URL=pglite:            → an in-memory Postgres, for trying it out without Neon (data is lost on exit)
// DATABASE_URL=pglite:./data      → the same, saved in a local folder
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { neonAuthVerifierFromUrl } from './auth'
import { appFromEnv } from './config'
import type { Sql } from './db'
import { SCHEMA } from './schema'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env file: use the environment as is.
}

async function localApp(): Promise<ReturnType<typeof createApp>> {
  const url = process.env.DATABASE_URL ?? ''
  const extra = {
    updates: () => import('./generated/update-bundle').then((m) => m.updateBundle),
    updateKey: process.env.UPDATE_KEY?.trim() || undefined
  }
  if (!url.startsWith('pglite:')) return appFromEnv(process.env, extra)
  const { PGlite } = await import('@electric-sql/pglite')
  const dir = url.slice('pglite:'.length) || undefined
  const db = new PGlite(dir)
  await db.exec(SCHEMA)
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows as never
  }
  console.log(`Using a local PGlite database${dir ? ` in ${dir}` : ' in memory'} (not Neon).`)
  const jwks = process.env.NEON_AUTH_JWKS_URL
  if (!jwks) throw new Error('Set NEON_AUTH_JWKS_URL to your Neon Auth JWKS address, so sign-ins can be checked.')
  return createApp({ sql, verifyToken: neonAuthVerifierFromUrl(jwks), ...extra })
}

const app = await localApp()
const port = Number(process.env.PORT) || 8787
serve({ fetch: app.fetch, port }, () => console.log(`Vanity API listening on http://localhost:${port}`))
