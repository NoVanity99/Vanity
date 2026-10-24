// Applies schema.sql to the database in DATABASE_URL (reads server/.env if present).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  process.loadEnvFile(join(root, '.env'))
} catch {
  // No .env: use the environment as is.
}
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL (in server/.env or the environment) to your Neon connection string.')
  process.exit(1)
}
const sql = neon(process.env.DATABASE_URL)
const statements = readFileSync(join(root, 'schema.sql'), 'utf8')
  .split(/;\s*$/m)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)
for (const statement of statements) await sql.query(statement)
console.log(`Applied ${statements.length} statements. Your Neon database is ready for Vanity.`)
