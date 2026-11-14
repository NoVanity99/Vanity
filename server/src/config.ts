import { createApp } from './app'
import { neonAuthVerifierFromUrl } from './auth'
import { neonMigrate, neonSql } from './db'

/**
 * Builds the app from environment variables. On Neon Functions both are injected automatically:
 * DATABASE_URL (the branch's Postgres) and NEON_AUTH_JWKS_URL (the keys that sign Neon Auth's tokens).
 */
export function appFromEnv(env: NodeJS.ProcessEnv = process.env, extra: Pick<Parameters<typeof createApp>[0], 'updates' | 'updateKey'> = {}) {
  const url = env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. On Neon it is injected for you; elsewhere use the pooled connection string of your Neon project.')
  const jwks = env.NEON_AUTH_JWKS_URL
  // Without it nobody can be signed in, so every account route answers "please sign in".
  // A host that only hands out app updates (the Vercel entry) can run like that.
  if (!jwks) console.warn('[vanity-api] NEON_AUTH_JWKS_URL is not set: account routes are off. On Neon, turn on Neon Auth for the branch (the deploy does this).')
  return createApp({ sql: neonSql(url), verifyToken: jwks ? neonAuthVerifierFromUrl(jwks) : async () => null, migrate: neonMigrate(url), ...extra })
}
