import type { Sql } from './db'
import { ADMIN_USERNAMES, VERIFIED_USERNAMES, type Roles } from './roles'

export interface Standing {
  banned: boolean
  reason: string
  /** Until when they can't post, message or join voice (ms), or null. */
  timeoutUntil: number | null
}

const NONE: Roles = { verified: false, admin: false }
const FINE: Standing = { banned: false, reason: '', timeoutUntil: null }
/** Other copies of the server learn about a badge, ban or time-out within this long. */
const FRESH_MS = 8000

const ms = (v: unknown): number | null => (v instanceof Date ? v.getTime() : typeof v === 'string' && v ? Date.parse(v) : typeof v === 'number' ? v : null)

/**
 * Who has an official badge and who is banned or timed out, by permanent account id, read from
 * the database and remembered for a few seconds (these are looked at on almost every request).
 *
 * Badges used to follow the username. Now that usernames can change, the names in roles.ts are
 * only a starting list: each is turned into a badge on the account that holds the name, once,
 * and after that the badge stays with the account. Admins change badges in the Admin tab.
 */
export function createPeople(sql: Sql, now: () => number = Date.now) {
  let roles = new Map<string, Roles>()
  let standing = new Map<string, Standing>()
  let loadedAt = 0
  let loading: Promise<void> | null = null

  async function seed(): Promise<void> {
    const names = [...new Set([...VERIFIED_USERNAMES, ...ADMIN_USERNAMES].map((n) => n.toLowerCase()))]
    if (!names.length) return
    const done = new Set((await sql<{ name: string }>`SELECT name FROM vanity.role_seeds WHERE name = ANY(${names}::text[])`).map((r) => r.name))
    const waiting = names.filter((n) => !done.has(n))
    if (!waiting.length) return
    const holders = await sql<{ id: string; name: string }>`SELECT id, lower(username) AS name FROM vanity.profiles WHERE lower(username) = ANY(${waiting}::text[])`
    for (const h of holders) {
      const verified = VERIFIED_USERNAMES.some((n) => n.toLowerCase() === h.name)
      const admin = ADMIN_USERNAMES.some((n) => n.toLowerCase() === h.name)
      const claimed = await sql`INSERT INTO vanity.role_seeds (name, user_id) VALUES (${h.name}, ${h.id}) ON CONFLICT DO NOTHING RETURNING name`
      if (!claimed.length) continue
      await sql`INSERT INTO vanity.roles (user_id, verified, admin) VALUES (${h.id}, ${verified}, ${admin})
        ON CONFLICT (user_id) DO UPDATE SET verified = vanity.roles.verified OR excluded.verified, admin = vanity.roles.admin OR excluded.admin`
    }
  }

  async function load(): Promise<void> {
    await seed()
    const r = await sql<{ user_id: string; verified: boolean; admin: boolean }>`SELECT user_id, verified, admin FROM vanity.roles WHERE verified OR admin`
    const m = await sql<{ user_id: string; banned: boolean; reason: string; timeout_until: unknown }>`SELECT user_id, banned, reason, timeout_until FROM vanity.moderation WHERE banned OR timeout_until > now()`
    roles = new Map(r.map((x) => [x.user_id, { verified: x.verified, admin: x.admin }]))
    standing = new Map(m.map((x) => [x.user_id, { banned: x.banned, reason: x.reason, timeoutUntil: ms(x.timeout_until) }]))
    loadedAt = now()
  }

  return {
    /** Makes sure what is remembered is recent. Called at the start of every signed-in request. */
    async fresh(): Promise<void> {
      if (now() - loadedAt < FRESH_MS && loadedAt) return
      loading ??= load().finally(() => (loading = null))
      await loading
    },
    /** Forget what is remembered: something just changed here. */
    changed(): void {
      loadedAt = 0
    },
    rolesOf: (id: string | null | undefined): Roles => (id ? (roles.get(id) ?? NONE) : NONE),
    standingOf(id: string): Standing {
      const s = standing.get(id)
      if (!s) return FINE
      return { ...s, timeoutUntil: s.timeoutUntil && s.timeoutUntil > now() ? s.timeoutUntil : null }
    },
    /** The names on the starting list that no account has claimed a badge with yet. */
    async unclaimedNames(): Promise<string[]> {
      const names = [...new Set([...VERIFIED_USERNAMES, ...ADMIN_USERNAMES].map((n) => n.toLowerCase()))]
      const done = new Set((await sql<{ name: string }>`SELECT name FROM vanity.role_seeds WHERE name = ANY(${names}::text[])`).map((r) => r.name))
      return names.filter((n) => !done.has(n))
    }
  }
}

export type People = ReturnType<typeof createPeople>
