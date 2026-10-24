import { createApp } from './app'
import { neonSql } from './db'

/** Builds the app from environment variables (DATABASE_URL, JWT_SECRET). */
export function appFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const url = env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Use the pooled connection string from your Neon project.')
  return createApp({
    sql: neonSql(url),
    jwtSecret: env.JWT_SECRET ?? '',
    // Built into the deployment by `npm run build`; loaded only when someone asks for an update.
    updates: () => import('./generated/update-bundle').then((m) => m.updateBundle),
    updateKey: env.UPDATE_KEY?.trim() || undefined
  })
}
