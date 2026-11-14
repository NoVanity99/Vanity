import { neon } from '@neondatabase/serverless'
import { schemaStatements } from './schema'

export type Row = Record<string, unknown>

/** A tagged-template SQL runner: sql`SELECT ... WHERE id = ${id}` → rows. Values are always sent as parameters. */
export type Sql = <T = Row>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>

/** Neon's serverless HTTP driver (works on Vercel and any Node host). */
export function neonSql(databaseUrl: string): Sql {
  const run = neon(databaseUrl)
  return (strings, ...values) => run(strings, ...values) as never
}

/** Creates Vanity's tables on a Neon database if they aren't there yet. */
export function neonMigrate(databaseUrl: string): () => Promise<void> {
  const run = neon(databaseUrl)
  return async () => {
    for (const statement of schemaStatements()) await run.query(statement)
  }
}
