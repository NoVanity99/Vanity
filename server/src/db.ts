import { neon } from '@neondatabase/serverless'

export type Row = Record<string, unknown>

/** A tagged-template SQL runner: sql`SELECT ... WHERE id = ${id}` → rows. Values are always sent as parameters. */
export type Sql = <T = Row>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>

/** Neon's serverless HTTP driver (works on Vercel and any Node host). */
export function neonSql(databaseUrl: string): Sql {
  const run = neon(databaseUrl)
  return (strings, ...values) => run(strings, ...values) as never
}
