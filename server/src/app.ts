import { friendsVoice, iceConfigFromEnv, voiceRoutes, type IceConfig } from './voice'
import { groupRoutes, validGifText } from './groups'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { VerifyToken } from './auth'
import type { Sql } from './db'
import { mergeStyle, readStyle, type ProfileStyle } from './profileStyle'
import { createPeople, type People } from './people'
import { usernameProblem } from './words'
import { coinRoutes, type StripeConfig } from './coins'
import { commentRoutes } from './comments'
import { adminRoutes } from './admin'
import { communityRoutes } from './communities'
import { createSteam, SteamError, type FetchFn } from './steam'
import { SyncError, syncUser } from './sync'
import { keyMatches, type UpdateBundle } from './updates'

export interface AppOptions {
  sql: Sql
  /** Checks a Neon Auth session token (see auth.ts). */
  verifyToken: VerifyToken
  /** Creates the tables if they are missing. Run once, before the first request that needs the database. */
  migrate?: () => Promise<void>
  /** Max username look-ups per IP per 10 minutes. */
  lookupRateLimit?: number
  /** Max syncs per account per minute. */
  syncRateLimit?: number
  /** Max messages one account may send per minute. */
  messageRateLimit?: number
  /** KLIPY's key for GIF search (optional: without it, only GIFs from people's devices). */
  klipyKey?: string
  /** STUN/TURN for voice rooms (TURN optional). */
  voiceIce?: IceConfig
  /** Max voice requests (checking in, connection details) per account per minute. */
  voiceRateLimit?: number
  /** The Steam Web API key: a server secret, never sent to the app. Empty: Steam routes say "not set up". */
  steamApiKey?: string
  /** Max Steam requests per account per minute. */
  steamRateLimit?: number
  /** Calls to Steam one account may cause per day. */
  steamDailyBudget?: number
  /** For calls to Steam (tests replace it). */
  fetchFn?: FetchFn
  now?: () => number
  /** The Vanity app update bundle built into this deployment, if any. */
  updates?: () => Promise<UpdateBundle | null>
  /** When set, /update needs this in the X-Update-Key header. */
  updateKey?: string
  /**
   * Signs in at Neon Auth with an email and password, for people who typed their username
   * (see POST /auth/sign-in). Without it, signing in by username is off.
   */
  authSignIn?: AuthSignIn
  /** The sign-in email of an account. Default: read from Neon Auth's own table in the same database. */
  emailOfUser?: (id: string) => Promise<string | null>
  /** Wrong passwords one username may get per 10 minutes before it is paused. */
  signInRateLimit?: number
  /** Stripe, for buying Vanity Coins. Without keys the store says purchases aren't set up. */
  stripe?: StripeConfig
  /** How long between username changes (ms). */
  usernameCooldownMs?: number
}

/** What Neon Auth answered to a sign-in: the app needs the cookies and the token as they are. */
export interface AuthSignInResult {
  status: number
  json: Record<string, unknown> | null
  setCookie: string[]
  jwt: string | null
}
export type AuthSignIn = (email: string, password: string) => Promise<AuthSignInResult>

/** One message for every failed sign-in, so nobody can learn which accounts exist. */
export const SIGN_IN_FAILED = 'Incorrect username/email or password.'

/** Sign-in at a Neon Auth address, from the server. */
export function neonAuthSignIn(baseUrl: string, origin = 'http://localhost:5173', fetchFn: typeof fetch = fetch): AuthSignIn {
  return async (email, password) => {
    const res = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', origin },
      body: JSON.stringify({ email, password, rememberMe: true }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000)
    })
    let json: Record<string, unknown> | null = null
    try {
      const parsed: unknown = await res.json()
      if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>
    } catch {
      // not JSON
    }
    return { status: res.status, json, setCookie: res.headers.getSetCookie(), jwt: res.headers.get('set-auth-jwt') }
  }
}

export type Env = { Variables: { userId: string; username: string; email: string | null } }

/** How long a call rings before it is given up on. */
export const RING_MS = 40_000
const USERNAME = /^[A-Za-z0-9_]{3,20}$/
/** A username can be changed once in this long. */
export const USERNAME_COOLDOWN_MS = 30 * 86_400_000
const ONLINE_WINDOW = '3 minutes'
const MAX_STATS = 5000
const MAX_BIO = 200
const MAX_MESSAGE = 2000
/** Messages one account may send per minute. */
const MESSAGE_RATE = 40
/** A profile picture is a small image the app has already shrunk: about 40 KB at most. */
const MAX_AVATAR_CHARS = 60_000
const AVATAR = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/** What everyone may see of an account: its name, picture and official badges. */
export type StatsVisibility = 'everyone' | 'friends' | 'private'
const VISIBILITIES: StatsVisibility[] = ['everyone', 'friends', 'private']
/** Who can see a player's stats (anything unknown counts as the default, everyone). */
export const visibilityOf = (v: unknown): StatsVisibility => (VISIBILITIES.includes(v as StatsVisibility) ? (v as StatsVisibility) : 'everyone')

export type PublicUser = { id: string; username: string; avatar: string | null; style: ProfileStyle; verified: boolean; admin: boolean }
export type PublicUserFn = (row: { id: string; username: string; avatar?: string | null; style?: unknown }) => PublicUser

/** A player as others see them. Badges come from the account's id, not its name. */
export const publicUserWith =
  (people: People): PublicUserFn =>
  (row) => ({ id: row.id, username: row.username, avatar: row.avatar ?? null, style: readStyle(row.style), ...people.rolesOf(row.id) })

export const fail = (status: 400 | 401 | 402 | 403 | 404 | 409 | 429, message: string, code?: string): never => {
  throw new HTTPException(status, { message, cause: code })
}

export function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' && v) return Date.parse(v)
  if (typeof v === 'number') return v
  return null
}

export async function body<T>(c: Context): Promise<Partial<T>> {
  try {
    const b = await c.req.json()
    return b && typeof b === 'object' ? (b as Partial<T>) : {}
  } catch {
    return {}
  }
}

/** How many days someone has played, their run of days up to today (or yesterday), and their longest run. */
function streaksOf(days: string[], nowMs: number): { days: number; current: number; best: number } {
  const set = new Set(days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))
  const sorted = [...set].sort()
  const dayNumber = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000)
  let best = 0
  let run = 0
  let prev = NaN
  for (const d of sorted) {
    const n = dayNumber(d)
    run = n === prev + 1 ? run + 1 : 1
    best = Math.max(best, run)
    prev = n
  }
  // The run counts if its last day is today or yesterday (the friend may be in another time zone).
  const today = Math.floor(nowMs / 86_400_000)
  const current = sorted.length && today - dayNumber(sorted[sorted.length - 1]) <= 1 ? run : 0
  return { days: set.size, current, best }
}

/** Shapes a presence row into what friends see. */
function status(row: { online: boolean; game_name: string | null; started_at: unknown; updated_at: unknown }): {
  state: 'playing' | 'online' | 'offline'
  gameName: string | null
  since: number | null
  lastSeen: number | null
} {
  if (row.online && row.game_name) return { state: 'playing', gameName: row.game_name, since: toMs(row.started_at), lastSeen: toMs(row.updated_at) }
  return { state: row.online ? 'online' : 'offline', gameName: null, since: null, lastSeen: toMs(row.updated_at) }
}

export function createApp({ sql, verifyToken, migrate, lookupRateLimit = 60, syncRateLimit = 30, messageRateLimit = MESSAGE_RATE, klipyKey = '', voiceIce, voiceRateLimit, steamApiKey = '', steamRateLimit = 30, steamDailyBudget, fetchFn, now, updates, updateKey, authSignIn, emailOfUser, signInRateLimit = 10, stripe, usernameCooldownMs = USERNAME_COOLDOWN_MS }: AppOptions): Hono<Env> {
  const app = new Hono<Env>()
  const clock = now ?? Date.now
  const people = createPeople(sql, clock)
  const publicUser = publicUserWith(people)

  // The tables are created on first use, so a fresh Neon database needs no manual setup.
  let migrated: Promise<void> | null = null
  const ready = async (): Promise<void> => {
    if (!migrate) return
    migrated ??= migrate().catch((err) => {
      migrated = null
      throw err
    })
    await migrated
  }

  // ---- basic rate limit for the public username check (per server instance) ----
  const attempts = new Map<string, { count: number; reset: number }>()
  const rateLimit: MiddlewareHandler<Env> = async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local'
    const now = Date.now()
    const a = attempts.get(ip)
    if (!a || a.reset < now) attempts.set(ip, { count: 1, reset: now + 10 * 60_000 })
    else if (++a.count > lookupRateLimit) fail(429, 'Too many attempts. Try again in a few minutes.')
    await next()
  }

  /** A valid Neon Auth session. The account may not have picked a username yet. */
  const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1]
    const user = token ? await verifyToken(token) : null
    if (!user) fail(401, 'Please sign in again.')
    await ready()
    await people.fresh()
    c.set('userId', user!.id)
    c.set('email', user!.email)
    await next()
  }

  /** Stops a banned account. Asked wherever an account does something others can see. */
  const notBanned = (id: string): void => {
    const s = people.standingOf(id)
    if (s.banned) fail(403, s.reason ? `This account has been banned: ${s.reason}` : 'This account has been banned.', 'banned')
  }
  /** Stops a timed-out account from posting, messaging or calling. */
  const canSpeak = (id: string): void => {
    notBanned(id)
    const until = people.standingOf(id).timeoutUntil
    if (until) fail(403, `You're timed out and can't do that until ${new Date(until).toUTCString().replace(' GMT', ' UTC')}.`, 'timed_out')
  }
  /** The words a banned or timed-out account is shown (for the admins' "See what they see"). */
  const problems = (id: string): { banned: string | null; speaking: string | null } => {
    const said = (fn: (id: string) => void): string | null => {
      try {
        fn(id)
        return null
      } catch (err) {
        return err instanceof HTTPException ? err.message : 'Not allowed.'
      }
    }
    return { banned: said(notBanned), speaking: said(canSpeak) }
  }
  const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
    if (!people.rolesOf(c.get('userId')).admin) fail(403, 'Only Vanity admins can do that.')
    await next()
  }

  /** A valid session whose account has a username (everything social needs one). */
  const requireUser: MiddlewareHandler<Env> = async (c, next) => {
    const [profile] = await sql<{ username: string }>`SELECT username FROM vanity.profiles WHERE id = ${c.get('userId')}`
    if (!profile) fail(409, 'Choose a username to finish setting up your account.', 'needs_username')
    notBanned(c.get('userId'))
    c.set('username', profile.username)
    await next()
  }

  const areFriends = async (a: string, b: string): Promise<boolean> => {
    const rows = await sql`SELECT 1 FROM vanity.friendships WHERE status = 'accepted'
      AND ((requester_id = ${a} AND addressee_id = ${b}) OR (requester_id = ${b} AND addressee_id = ${a}))`
    return rows.length > 0
  }

  app.get('/', (c) => c.json({ name: 'vanity-api', ok: true, auth: 'neon' }))

  // ---- app updates (the desktop app checks these every minute) ----
  const updateBundle = async (c: Context): Promise<UpdateBundle> => {
    if (updateKey && !keyMatches(c.req.header('x-update-key'), updateKey)) fail(401, 'This update key is wrong.')
    const bundle = updates ? await updates() : null
    if (!bundle) fail(404, 'This server has no update bundle. Redeploy it on Vercel to build one.')
    return bundle!
  }
  app.get('/update', async (c) => {
    const b = await updateBundle(c)
    c.header('Cache-Control', 'no-store')
    return c.json({ version: b.version, changelog: b.changelog, sha: b.sha, builtAt: b.builtAt, size: b.size })
  })
  app.get('/update/download', async (c) => {
    const b = await updateBundle(c)
    return new Response(Buffer.from(b.zipBase64, 'base64'), {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="vanity-${b.version}.zip"`, 'Cache-Control': 'no-store' }
    })
  })

  // ---- accounts ------------------------------------------------------------

  /** Whether a username is free. Public, so the sign-up form can check before the account is created. */
  app.get('/usernames/:name', rateLimit, async (c) => {
    const name = c.req.param('name')
    if (!USERNAME.test(name)) fail(400, 'Usernames are 3–20 letters, numbers or underscores.')
    await ready()
    const taken = await sql`SELECT 1 FROM vanity.profiles WHERE lower(username) = lower(${name})`
    return c.json({ available: taken.length === 0 })
  })

  /** When this account last changed its username, and when it may again (ms; null = now). */
  const usernameChange = async (id: string): Promise<{ usernameChangedAt: number | null; usernameChangeAt: number | null }> => {
    const [last] = await sql<{ changed_at: unknown }>`SELECT changed_at FROM vanity.username_history WHERE user_id = ${id} AND old_username IS NOT NULL AND NOT by_admin AND lower(old_username) <> lower(new_username) ORDER BY changed_at DESC LIMIT 1`
    const at = toMs(last?.changed_at)
    const next = at ? at + usernameCooldownMs : null
    return { usernameChangedAt: at, usernameChangeAt: next && next > clock() ? next : null }
  }

  /** The signed-in account as the app sees it. */
  const account = async (c: Context<Env>) => {
    const [profile] = await sql<{ username: string; avatar: string | null; bio: string | null; style: unknown; stats_visibility: string | null }>`SELECT username, avatar, bio, style, stats_visibility FROM vanity.profiles WHERE id = ${c.get('userId')}`
    return { id: c.get('userId'), email: c.get('email'), username: profile?.username ?? null, avatar: profile?.avatar ?? null, bio: profile?.bio ?? '', style: readStyle(profile?.style), statsVisibility: visibilityOf(profile?.stats_visibility), ...people.rolesOf(c.get('userId')), ...(await usernameChange(c.get('userId'))), standing: people.standingOf(c.get('userId')) }
  }

  /**
   * Whether an email already has an account. Public (the sign-up form asks before creating
   * the account) and rate-limited. Sign-in accounts live in Neon Auth's own tables in the same
   * database; `inUse` is null when those can't be read, and Neon Auth's own refusal at sign-up
   * is then what stops a second account (it enforces one account per email itself).
   */
  app.post('/emails/check', rateLimit, async (c) => {
    const { email } = await body<{ email: string }>(c)
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) || email.length > 320) fail(400, "That doesn't look like an email address.")
    let inUse: boolean | null = null
    try {
      const rows = await sql`SELECT 1 FROM neon_auth."user" WHERE lower(email) = lower(${email!.trim()}) LIMIT 1`
      inUse = rows.length > 0
    } catch {
      // Neon Auth's tables aren't readable from here: leave it to Neon Auth.
    }
    return c.json({ inUse })
  })

  const emailOf =
    emailOfUser ??
    (async (id: string): Promise<string | null> => {
      try {
        const [row] = await sql<{ email: string }>`SELECT email FROM neon_auth."user" WHERE id::text = ${id} LIMIT 1`
        return row?.email ?? null
      } catch {
        return null
      }
    })
  /** Writes down what an admin did. */
  const logAdmin = async (adminId: string, action: string, targetId: string | null, detail = ''): Promise<void> => {
    await sql`INSERT INTO vanity.admin_log (admin_id, target_id, action, detail) VALUES (${adminId}, ${targetId}, ${action}, ${detail.slice(0, 500)})`
  }
  const wrongPasswords = new Map<string, { count: number; reset: number }>()

  /**
   * Signing in with a username. The app can't ask Neon Auth itself, because Neon Auth only knows
   * emails and a username must never be turned into its email for a stranger. So the server looks
   * the email up privately, signs in at Neon Auth, and hands the session back. The password is
   * passed on over https and never stored or logged. Every failure reads the same.
   */
  app.post('/auth/sign-in', rateLimit, async (c) => {
    const { username, password } = await body<{ username: string; password: string }>(c)
    if (typeof username !== 'string' || typeof password !== 'string' || !password || password.length > 256 || !USERNAME.test(username.trim())) fail(401, SIGN_IN_FAILED)
    if (!authSignIn) fail(409, 'Signing in with a username is not available right now. Use your email instead.', 'username_sign_in_off')
    const key = username!.trim().toLowerCase()
    const at = Date.now()
    const tries = wrongPasswords.get(key)
    if (tries && tries.reset > at && tries.count >= signInRateLimit) fail(429, 'Too many attempts. Wait a few minutes and try again.')
    const miss = (): never => {
      const t = wrongPasswords.get(key)
      if (!t || t.reset < at) wrongPasswords.set(key, { count: 1, reset: at + 10 * 60_000 })
      else t.count++
      return fail(401, SIGN_IN_FAILED)
    }
    await ready()
    const [profile] = await sql<{ id: string }>`SELECT id FROM vanity.profiles WHERE lower(username) = ${key}`
    const email = profile ? await emailOf(profile.id) : null
    if (!email) miss()
    let res: AuthSignInResult
    try {
      res = await authSignIn!(email!, password!)
    } catch {
      throw new HTTPException(503 as never, { message: "Vanity's sign-in service can't be reached. Try again in a moment." })
    }
    if (res.status === 429) fail(429, 'Too many attempts. Wait a minute and try again.')
    if (res.status >= 500) throw new HTTPException(503 as never, { message: "Vanity's sign-in service is having trouble. Try again in a moment." })
    const user = res.json?.user as { id?: unknown; email?: unknown; name?: unknown } | undefined
    if (res.status < 200 || res.status >= 300 || !user || typeof user.id !== 'string' || !res.setCookie.length) {
      // An address that still has to be confirmed is the one thing worth saying (the password was right).
      if (res.json?.code === 'EMAIL_NOT_VERIFIED') fail(403, 'Check your email and confirm your address first, then sign in.')
      miss()
    }
    wrongPasswords.delete(key)
    c.header('Cache-Control', 'no-store')
    return c.json({ user: { id: user!.id, email: String(user!.email ?? ''), name: String(user!.name ?? '') }, setCookie: res.setCookie, jwt: res.jwt })
  })

  app.get('/me', requireAuth, async (c) => {
    return c.json({ user: await account(c) })
  })

  /** Sets the profile picture (null removes it) and/or the bio. Fields left out stay as they are. */
  app.put('/me/profile', requireAuth, requireUser, async (c) => {
    const b = await body<{ avatar: string | null; bio: string; style: Partial<ProfileStyle>; statsVisibility: string }>(c)
    const id = c.get('userId')
    if (b.statsVisibility !== undefined) {
      if (!VISIBILITIES.includes(b.statsVisibility as StatsVisibility)) fail(400, 'Pick everyone, friends or only you.')
      await sql`UPDATE vanity.profiles SET stats_visibility = ${b.statsVisibility} WHERE id = ${id}`
    }
    if (b.avatar !== undefined) {
      if (b.avatar !== null && (typeof b.avatar !== 'string' || !AVATAR.test(b.avatar))) fail(400, 'That picture could not be used. Try a PNG or JPEG image.')
      if (b.avatar !== null && b.avatar.length > MAX_AVATAR_CHARS) fail(400, 'That picture is too large.')
      await sql`UPDATE vanity.profiles SET avatar = ${b.avatar} WHERE id = ${id}`
    }
    if (b.bio !== undefined) {
      if (typeof b.bio !== 'string') fail(400, 'The bio must be text.')
      // One paragraph: line breaks and odd spacing are flattened.
      const bio = b.bio!.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
      if ([...bio].length > MAX_BIO) fail(400, `Bios can be up to ${MAX_BIO} characters.`)
      await sql`UPDATE vanity.profiles SET bio = ${bio} WHERE id = ${id}`
    }
    if (b.style !== undefined) {
      // Only ids from the fixed lists (profileStyle.ts); the fields that were sent change, the rest stay.
      const [row] = await sql<{ style: unknown }>`SELECT style FROM vanity.profiles WHERE id = ${id}`
      const next = mergeStyle(readStyle(row?.style), b.style)
      if (!next) fail(400, "That profile look isn't one Vanity knows. Update Vanity and try again.")
      // A premium look has to be bought with coins first.
      const locked = await coins.lockedLook(id, b.style as Record<string, unknown>)
      if (locked) fail(402, `${locked.name} costs ${locked.price.toLocaleString('en-US')} coins. Get it in the store first.`, 'look_locked')
      await sql`UPDATE vanity.profiles SET style = ${JSON.stringify(next)} WHERE id = ${id}`
    }
    return c.json({ user: await account(c) })
  })

  /** Picks the username for a new account, or renames an existing one. */
  app.put('/me/username', requireAuth, async (c) => {
    const { username } = await body<{ username: string }>(c)
    if (typeof username !== 'string' || !USERNAME.test(username)) fail(400, 'Usernames are 3–20 letters, numbers or underscores.')
    const me = c.get('userId')
    notBanned(me)
    const [current] = await sql<{ username: string }>`SELECT username FROM vanity.profiles WHERE id = ${me}`
    if (current?.username === username) return c.json({ user: await account(c) })
    // Changing only the capitals of your own name is always fine; anything else is checked.
    const sameName = current?.username.toLowerCase() === username!.toLowerCase()
    if (!sameName) {
      const problem = usernameProblem(username!)
      if (problem) fail(400, problem, 'username_blocked')
      // A name on the official list is kept for the person it is meant for.
      if (current && (await people.unclaimedNames()).includes(username!.toLowerCase())) fail(409, 'That username is already in use.')
    }
    if (current && !sameName) {
      const { usernameChangeAt } = await usernameChange(me)
      if (usernameChangeAt) fail(429, `You can change your username again on ${new Date(usernameChangeAt).toUTCString().slice(5, 16)}.`, 'username_cooldown')
    }
    const taken = await sql`SELECT 1 FROM vanity.profiles WHERE lower(username) = lower(${username}) AND id <> ${me}`
    if (taken.length) fail(409, 'That username is already in use.')
    try {
      await sql`INSERT INTO vanity.profiles (id, username) VALUES (${me}, ${username})
        ON CONFLICT (id) DO UPDATE SET username = excluded.username`
    } catch {
      // Lost a race with someone picking the same name.
      fail(409, 'That username is already in use.')
    }
    // Everything else refers to the account by its id, so the new name shows everywhere at once.
    await sql`INSERT INTO vanity.username_history (user_id, old_username, new_username, changed_at) VALUES (${me}, ${current?.username ?? null}, ${username}, to_timestamp(${clock() / 1000}))`
    // A first username may be one on the official list: its badge is given now.
    people.changed()
    await people.fresh()
    return c.json({ user: await account(c) })
  })

  /**
   * The quick check-in, every few seconds while Vanity is open: what changed for this account
   * that should show without a restart. Its coins, its name and badges, a ban or time-out, and
   * calls ringing for it.
   */
  app.get('/pulse', requireAuth, async (c) => {
    const me = c.get('userId')
    const [p] = await sql<{ username: string }>`SELECT username FROM vanity.profiles WHERE id = ${me}`
    const [w] = await sql<{ balance: number }>`SELECT balance FROM vanity.coin_wallets WHERE user_id = ${me}`
    const rings = p
      ? await sql<{ room_id: string; from_id: string; username: string; avatar: string | null; style: unknown; chat: string | null; created_at: unknown }>`
          SELECT g.room_id, g.from_id, f.username, f.avatar, f.style, r.chat, g.created_at
          FROM vanity.voice_rings g JOIN vanity.voice_rooms r ON r.id = g.room_id JOIN vanity.profiles f ON f.id = g.from_id
          WHERE g.user_id = ${me} AND g.created_at > to_timestamp(${(clock() - RING_MS) / 1000}) ORDER BY g.created_at DESC LIMIT 3`
      : []
    const groupIds = rings.map((r) => (r.chat?.startsWith('group:') ? r.chat.slice(6) : '')).filter(Boolean)
    const groups = groupIds.length ? await sql<{ id: string; name: string }>`SELECT id, name FROM vanity.chat_groups WHERE id = ANY(${groupIds}::text[])` : []
    c.header('Cache-Control', 'no-store')
    return c.json({
      id: me,
      username: p?.username ?? null,
      ...people.rolesOf(me),
      standing: people.standingOf(me),
      coins: w?.balance ?? 0,
      calls: rings.map((r) => ({
        roomId: r.room_id,
        from: publicUser({ id: r.from_id, username: r.username, avatar: r.avatar, style: r.style }),
        group: r.chat?.startsWith('group:') ? (groups.find((g) => g.id === r.chat!.slice(6)) ?? null) : null,
        at: toMs(r.created_at)
      }))
    })
  })

  /** Removes everything Vanity stores about the account (profile, friends, presence, stats). */
  app.delete('/me', requireAuth, async (c) => {
    await sql`DELETE FROM vanity.profiles WHERE id = ${c.get('userId')}`
    return c.body(null, 204)
  })

  // ---- presence and stats --------------------------------------------------

  app.put('/presence', requireAuth, requireUser, async (c) => {
    const b = await body<{ gameKey: string | null; gameName: string | null; startedAt: number | null }>(c)
    const gameKey = typeof b.gameKey === 'string' ? b.gameKey.slice(0, 200) : null
    const gameName = gameKey && typeof b.gameName === 'string' ? b.gameName.slice(0, 200) : null
    const startedAt = gameKey && typeof b.startedAt === 'number' && Number.isFinite(b.startedAt) ? b.startedAt / 1000 : null
    await sql`INSERT INTO vanity.presence (user_id, game_key, game_name, started_at, signed_off, updated_at)
      VALUES (${c.get('userId')}, ${gameKey}, ${gameName}, CASE WHEN ${startedAt}::float8 IS NULL THEN NULL ELSE to_timestamp(${startedAt}::float8) END, false, now())
      ON CONFLICT (user_id) DO UPDATE SET game_key = excluded.game_key, game_name = excluded.game_name,
        started_at = excluded.started_at, signed_off = false, updated_at = now()`
    // The app checks in here about once a minute, so the answer carries the account's official
    // badges: one granted or taken away in roles.ts reaches every running app without an update.
    return c.json(people.rolesOf(c.get('userId')))
  })

  app.delete('/presence', requireAuth, requireUser, async (c) => {
    await sql`UPDATE vanity.presence SET game_key = NULL, game_name = NULL, started_at = NULL, signed_off = true, updated_at = now() WHERE user_id = ${c.get('userId')}`
    return c.body(null, 204)
  })

  app.put('/stats', requireAuth, requireUser, async (c) => {
    const b = await body<{ games: { gameKey: string; gameName: string; playtimeSeconds: number; lastPlayedAt: number | null }[] }>(c)
    if (!Array.isArray(b.games)) fail(400, 'Expected { games: [...] }.')
    if (b.games!.length > MAX_STATS) fail(400, `At most ${MAX_STATS} games per sync.`)
    const byKey = new Map<string, { name: string; seconds: number; last: number | null }>()
    for (const g of b.games!) {
      if (!g || typeof g.gameKey !== 'string' || !g.gameKey || typeof g.gameName !== 'string') continue
      const seconds = Math.max(0, Math.min(1_000_000_000, Math.floor(Number(g.playtimeSeconds) || 0)))
      const last = typeof g.lastPlayedAt === 'number' && Number.isFinite(g.lastPlayedAt) ? g.lastPlayedAt / 1000 : null
      byKey.set(g.gameKey.slice(0, 200), { name: g.gameName.slice(0, 200), seconds, last })
    }
    if (byKey.size) {
      const keys = [...byKey.keys()]
      const names = keys.map((k) => byKey.get(k)!.name)
      const seconds = keys.map((k) => byKey.get(k)!.seconds)
      const lasts = keys.map((k) => byKey.get(k)!.last)
      await sql`INSERT INTO vanity.game_stats (user_id, game_key, game_name, playtime_seconds, last_played_at, updated_at)
        SELECT ${c.get('userId')}, t.k, t.n, t.p, CASE WHEN t.l IS NULL THEN NULL ELSE to_timestamp(t.l) END, now()
        FROM unnest(${keys}::text[], ${names}::text[], ${seconds}::int[], ${lasts}::float8[]) AS t(k, n, p, l)
        ON CONFLICT (user_id, game_key) DO UPDATE SET game_name = excluded.game_name,
          playtime_seconds = excluded.playtime_seconds, last_played_at = excluded.last_played_at, updated_at = now()`
    }
    return c.json({ synced: byKey.size })
  })

  // ---- cloud-saved progress --------------------------------------------------

  // Each account may sync this often (per server instance). The app syncs every few minutes and after changes.
  const syncs = new Map<string, { count: number; reset: number }>()
  app.post('/sync', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const now = Date.now()
    const s = syncs.get(me)
    if (!s || s.reset < now) syncs.set(me, { count: 1, reset: now + 60_000 })
    else if (++s.count > syncRateLimit) fail(429, 'Syncing too often. Vanity will try again shortly.')
    try {
      return c.json(await syncUser(sql, me, await body(c)))
    } catch (err) {
      if (err instanceof SyncError) fail(400, err.message)
      throw err
    }
  })

  // ---- Steam (the key stays on this server) ------------------------------------

  const steam = createSteam({ sql, apiKey: steamApiKey, fetchFn, now, dailyBudget: steamDailyBudget })
  const steamHits = new Map<string, { count: number; reset: number }>()
  /** Per-account request limit, on top of the daily budget of calls to Steam. */
  const steamLimit: MiddlewareHandler<Env> = async (c, next) => {
    const me = c.get('userId')
    const t = Date.now()
    const h = steamHits.get(me)
    if (!h || h.reset < t) steamHits.set(me, { count: 1, reset: t + 60_000 })
    else if (++h.count > steamRateLimit) fail(429, 'Too many Steam requests. Wait a minute and try again.', 'rate_limited')
    await next()
  }
  /** Runs a Steam call, turning its errors into answers the app can show. */
  const steamAnswer = async <T>(c: Context<Env>, fn: () => Promise<T>): Promise<Response> => {
    try {
      return c.json(await fn())
    } catch (err) {
      if (err instanceof SteamError) return c.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status)
      throw err
    }
  }
  const signedIn = [requireAuth, requireUser, steamLimit] as const

  app.get('/steam/link', requireAuth, requireUser, (c) => steamAnswer(c, async () => ({ configured: steam.configured, link: await steam.getLink(c.get('userId')) })))
  /** Links a Steam account from a SteamID64, a profile link or a custom URL name. */
  app.put('/steam/link', ...signedIn, (c) =>
    steamAnswer(c, async () => {
      const { input } = await body<{ input: string }>(c)
      return { link: await steam.link(c.get('userId'), typeof input === 'string' ? input.slice(0, 300) : '') }
    })
  )
  app.delete('/steam/link', requireAuth, requireUser, async (c) => {
    await steam.unlink(c.get('userId'))
    return c.body(null, 204)
  })
  /** Looks an account up without linking it (to show "is this you?"). */
  app.post('/steam/resolve', ...signedIn, (c) =>
    steamAnswer(c, async () => {
      const { input } = await body<{ input: string }>(c)
      const me = c.get('userId')
      return { profile: await steam.summary(me, await steam.resolve(me, typeof input === 'string' ? input.slice(0, 300) : '')) }
    })
  )
  app.get('/steam/owned-games', ...signedIn, (c) =>
    steamAnswer(c, async () => {
      const me = c.get('userId')
      return { games: await steam.ownedGames(me, await steam.linkedId(me)) }
    })
  )
  app.get('/steam/recent-games', ...signedIn, (c) =>
    steamAnswer(c, async () => {
      const me = c.get('userId')
      return { games: await steam.recentGames(me, await steam.linkedId(me)) }
    })
  )
  app.get('/steam/achievements/:appId', ...signedIn, (c) =>
    steamAnswer(c, async () => {
      const me = c.get('userId')
      const appId = Number(c.req.param('appId'))
      if (!Number.isInteger(appId) || appId <= 0 || appId > 2_000_000_000) throw new SteamError("That isn't a Steam app id.")
      return steam.achievements(me, await steam.linkedId(me), appId)
    })
  )
  /** Total achievements unlocked. Worked out a batch of games at a time: ask again while `complete` is false. */
  app.get('/steam/achievements-summary', ...signedIn, (c) =>
    steamAnswer(c, async () => {
      const me = c.get('userId')
      return steam.achievementSummary(me, await steam.linkedId(me))
    })
  )

  // "Sign in through Steam": the app opens the address from /start in the browser; Steam sends
  // the browser back to /return, where the answer is checked with Steam and the account linked.
  const origin = (c: Context<Env>): string => {
    const url = new URL(c.req.url)
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? url.host
    const proto = c.req.header('x-forwarded-proto') ?? (/^(localhost|127\.)/.test(host) ? url.protocol.replace(':', '') : 'https')
    return `${proto}://${host}`
  }
  app.post('/steam/openid/start', ...signedIn, (c) => steamAnswer(c, async () => ({ url: (await steam.openIdStart(c.get('userId'), origin(c))).url })))
  app.get('/steam/openid/return', async (c) => {
    await ready()
    const page = (title: string, text: string, ok: boolean): Response =>
      c.html(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
          `<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d12;color:#f2f3f7;font-family:system-ui,sans-serif;text-align:center;padding:24px">` +
          `<div><div style="font-size:56px">${ok ? '✅' : '⚠️'}</div><h1 style="font-size:24px;margin:16px 0 8px">${title}</h1><p style="color:#9aa0b0;max-width:420px;line-height:1.5">${text}</p></div></body></html>`,
        ok ? 200 : 400
      )
    const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
    try {
      const link = await steam.openIdReturn(new URL(c.req.url).searchParams, origin(c))
      return page('Steam linked', `${esc(link.name)} is now linked to your Vanity account. You can close this tab and go back to Vanity.`, true)
    } catch (err) {
      if (err instanceof SteamError) return page("Steam wasn't linked", esc(err.message), false)
      throw err
    }
  })

  // ---- friends -------------------------------------------------------------

  app.get('/friends', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const friends = await sql<{
      id: string
      username: string
      avatar: string | null
      bio: string | null
      style: unknown
      online: boolean
      game_name: string | null
      started_at: unknown
      updated_at: unknown
      total: number
      games: number
      top_game: string | null
      level: number | null
      xp: number | null
      unread: number
      last_id: string | number | null
      last_body: string | null
      last_at: unknown
      last_mine: boolean | null
    }>`
      SELECT u.id, u.username, u.avatar, u.bio, u.style,
        COALESCE(NOT p.signed_off AND p.updated_at > now() - ${ONLINE_WINDOW}::interval, false) AS online,
        p.game_name, p.started_at, p.updated_at,
        COALESCE((SELECT SUM(playtime_seconds) FROM vanity.game_stats s WHERE s.user_id = u.id), 0)::int AS total,
        (SELECT COUNT(*) FROM vanity.game_stats s WHERE s.user_id = u.id AND s.playtime_seconds > 0)::int AS games,
        (SELECT game_name FROM vanity.game_stats s WHERE s.user_id = u.id ORDER BY playtime_seconds DESC LIMIT 1) AS top_game,
        st.level, st.xp,
        (SELECT COUNT(*) FROM vanity.messages m WHERE m.recipient_id = ${me} AND m.sender_id = u.id AND m.read_at IS NULL)::int AS unread,
        lm.id AS last_id, lm.body AS last_body, lm.created_at AS last_at, (lm.sender_id = ${me}) AS last_mine
      FROM vanity.friendships f
      JOIN vanity.profiles u ON u.id = CASE WHEN f.requester_id = ${me} THEN f.addressee_id ELSE f.requester_id END
      LEFT JOIN vanity.presence p ON p.user_id = u.id
      LEFT JOIN vanity.user_state st ON st.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT m.id, m.body, m.created_at, m.sender_id FROM vanity.messages m
        WHERE least(m.sender_id, m.recipient_id) = least(${me}, u.id) AND greatest(m.sender_id, m.recipient_id) = greatest(${me}, u.id)
        ORDER BY m.id DESC LIMIT 1
      ) lm ON true
      WHERE f.status = 'accepted' AND (f.requester_id = ${me} OR f.addressee_id = ${me})
      ORDER BY lower(u.username)`
    const incoming = await sql<{ id: string; username: string; avatar: string | null; style: unknown; created_at: unknown }>`
      SELECT u.id, u.username, u.avatar, u.style, f.created_at FROM vanity.friendships f JOIN vanity.profiles u ON u.id = f.requester_id
      WHERE f.addressee_id = ${me} AND f.status = 'pending' ORDER BY f.created_at DESC`
    const outgoing = await sql<{ id: string; username: string; avatar: string | null; style: unknown; created_at: unknown }>`
      SELECT u.id, u.username, u.avatar, u.style, f.created_at FROM vanity.friendships f JOIN vanity.profiles u ON u.id = f.addressee_id
      WHERE f.requester_id = ${me} AND f.status = 'pending' ORDER BY f.created_at DESC`
    // Which friends are in a voice room you may see (and join).
    const voiceOf = await friendsVoice(sql, me, friends.map((f) => f.id), (now ?? Date.now)())
    return c.json({
      friends: friends.map((f) => ({
        ...publicUser(f),
        voice: voiceOf.get(f.id) ?? null,
        bio: f.bio ?? '',
        status: status(f),
        totalPlaytimeSeconds: f.total,
        gamesPlayed: f.games,
        topGame: f.top_game,
        level: f.level ?? 1,
        xp: f.xp ?? 0,
        unread: f.unread ?? 0,
        lastMessage: f.last_id == null ? null : { id: Number(f.last_id), text: (f.last_body ?? '').slice(0, 200), at: toMs(f.last_at), mine: f.last_mine === true }
      })),
      incoming: incoming.map((r) => ({ ...publicUser(r), createdAt: toMs(r.created_at) })),
      outgoing: outgoing.map((r) => ({ ...publicUser(r), createdAt: toMs(r.created_at) }))
    })
  })

  app.post('/friends/requests', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const { username } = await body<{ username: string }>(c)
    if (typeof username !== 'string' || !username.trim()) fail(400, 'Enter a username.')
    const [target] = await sql<{ id: string; username: string }>`SELECT id, username FROM vanity.profiles WHERE lower(username) = lower(${username!.trim()})`
    if (!target) fail(404, `No one is called "${username!.trim()}".`)
    if (target.id === me) fail(400, "That's you!")
    const [existing] = await sql<{ requester_id: string; status: string }>`SELECT requester_id, status FROM vanity.friendships
      WHERE (requester_id = ${me} AND addressee_id = ${target.id}) OR (requester_id = ${target.id} AND addressee_id = ${me})`
    if (existing?.status === 'accepted') fail(409, `You're already friends with ${target.username}.`)
    if (existing && existing.requester_id === target.id) {
      // They already asked us: accept.
      await sql`UPDATE vanity.friendships SET status = 'accepted' WHERE requester_id = ${target.id} AND addressee_id = ${me}`
      return c.json({ status: 'accepted', user: target })
    }
    if (!existing) await sql`INSERT INTO vanity.friendships (requester_id, addressee_id, status) VALUES (${me}, ${target.id}, 'pending')`
    return c.json({ status: 'pending', user: target }, existing ? 200 : 201)
  })

  app.post('/friends/requests/:id/accept', requireAuth, requireUser, async (c) => {
    const rows = await sql`UPDATE vanity.friendships SET status = 'accepted'
      WHERE requester_id = ${c.req.param('id')} AND addressee_id = ${c.get('userId')} AND status = 'pending' RETURNING 1`
    if (!rows.length) fail(404, 'That request is no longer there.')
    return c.json({ status: 'accepted' })
  })

  /** Declines an incoming request or cancels an outgoing one. */
  app.delete('/friends/requests/:id', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const other = c.req.param('id')
    await sql`DELETE FROM vanity.friendships WHERE status = 'pending'
      AND ((requester_id = ${other} AND addressee_id = ${me}) OR (requester_id = ${me} AND addressee_id = ${other}))`
    return c.body(null, 204)
  })

  app.delete('/friends/:id', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const other = c.req.param('id')
    await sql`DELETE FROM vanity.friendships WHERE status = 'accepted'
      AND ((requester_id = ${other} AND addressee_id = ${me}) OR (requester_id = ${me} AND addressee_id = ${other}))`
    return c.body(null, 204)
  })

  /**
   * A player's profile and stats. Who may see them is the player's choice: everyone signed in
   * (the default), friends only, or only themselves. `/users/:id/stats` and the older
   * `/friends/:id/stats` are the same.
   */
  const playerStats = async (c: Context<Env>) => {
    const id = c.req.param('id') ?? ''
    const viewer = c.get('userId')
    const [who] = await sql<{ username: string; stats_visibility: string | null }>`SELECT username, stats_visibility FROM vanity.profiles WHERE id = ${id}`
    if (!who) fail(404, "That player doesn't exist (any more).", 'no_user')
    const friends = viewer === id || (await areFriends(viewer, id))
    const visibility = visibilityOf(who!.stats_visibility)
    if (viewer !== id && (visibility === 'private' || (visibility === 'friends' && !friends))) {
      fail(403, visibility === 'private' ? `${who!.username} keeps their profile private.` : `${who!.username} only shows their profile to friends.`, 'stats_hidden')
    }
    const [user] = await sql<{ username: string; avatar: string | null; bio: string | null; style: unknown }>`SELECT username, avatar, bio, style FROM vanity.profiles WHERE id = ${id}`
    const [st] = await sql<{ level: number; xp: number; badges: unknown }>`SELECT level, xp, badges FROM vanity.user_state WHERE user_id = ${id}`
    const badges = typeof st?.badges === 'string' ? (JSON.parse(st.badges) as Record<string, number>) : ((st?.badges as Record<string, number> | undefined) ?? {})
    const me = c.get('userId')
    const [user2] = await sql<{ created_at: unknown }>`SELECT created_at FROM vanity.profiles WHERE id = ${id}`
    const [state] = await sql<{ days: unknown }>`SELECT days FROM vanity.user_state WHERE user_id = ${id}`
    const games = await sql<{ game_key: string; game_name: string; playtime_seconds: number; last_played_at: unknown }>`
      SELECT game_key, game_name, playtime_seconds, last_played_at FROM vanity.game_stats
      WHERE user_id = ${id} AND playtime_seconds > 0 ORDER BY playtime_seconds DESC`
    // Launches and the first time each game was played, added up over the friend's devices.
    const perGame = await sql<{ game_key: string; launches: number; first_played_at: unknown }>`
      SELECT game_key, SUM(launches)::int AS launches, MIN(first_played_at) AS first_played_at
      FROM vanity.device_games WHERE user_id = ${id} GROUP BY game_key`
    const extra = new Map(perGame.map((g) => [g.game_key, g]))
    const prefs = await sql<{ game_key: string; favorite: boolean; play_status: string | null; user_rating: number | null }>`
      SELECT game_key, favorite, play_status, user_rating FROM vanity.game_prefs WHERE user_id = ${id}`
    const pref = new Map(prefs.map((p) => [p.game_key, p]))
    const [counts] = await sql<{ friends: number; mutual: number }>`
      SELECT
        (SELECT COUNT(*) FROM vanity.friendships f WHERE f.status = 'accepted' AND (f.requester_id = ${id} OR f.addressee_id = ${id}))::int AS friends,
        (SELECT COUNT(*) FROM vanity.friendships a
           JOIN vanity.friendships b ON b.status = 'accepted'
            AND (CASE WHEN b.requester_id = ${me} THEN b.addressee_id ELSE b.requester_id END) = (CASE WHEN a.requester_id = ${id} THEN a.addressee_id ELSE a.requester_id END)
            AND (b.requester_id = ${me} OR b.addressee_id = ${me})
          WHERE a.status = 'accepted' AND (a.requester_id = ${id} OR a.addressee_id = ${id}))::int AS mutual`
    const [steamLink] = await sql<{ display_name: string; profile_url: string }>`
      SELECT display_name, profile_url FROM vanity.linked_accounts WHERE user_id = ${id} AND provider = 'steam'`
    const [mine] = await sql<{ sent: number; received: number; first_at: unknown }>`
      SELECT COUNT(*) FILTER (WHERE sender_id = ${me})::int AS sent, COUNT(*) FILTER (WHERE sender_id = ${id})::int AS received, MIN(created_at) AS first_at
      FROM vanity.messages WHERE least(sender_id, recipient_id) = least(${me}, ${id}) AND greatest(sender_id, recipient_id) = greatest(${me}, ${id})`
    const [since] = await sql<{ created_at: unknown }>`SELECT created_at FROM vanity.friendships
      WHERE (requester_id = ${me} AND addressee_id = ${id}) OR (requester_id = ${id} AND addressee_id = ${me})`

    const days = (typeof state?.days === 'string' ? (JSON.parse(state.days) as unknown) : state?.days) ?? []
    const streaks = streaksOf(Array.isArray(days) ? days.filter((d): d is string => typeof d === 'string') : [], (now ?? Date.now)())
    const shape = (g: (typeof games)[number]) => ({
      gameKey: g.game_key,
      gameName: g.game_name,
      playtimeSeconds: g.playtime_seconds,
      lastPlayedAt: toMs(g.last_played_at),
      launches: extra.get(g.game_key)?.launches ?? 0,
      firstPlayedAt: toMs(extra.get(g.game_key)?.first_played_at),
      favorite: pref.get(g.game_key)?.favorite === true,
      playStatus: pref.get(g.game_key)?.play_status ?? null,
      rating: pref.get(g.game_key)?.user_rating ?? null
    })
    const rated = prefs.filter((p) => typeof p.user_rating === 'number')
    return c.json({
      username: user?.username ?? '',
      avatar: user?.avatar ?? null,
      bio: user?.bio ?? '',
      style: readStyle(user?.style),
      ...people.rolesOf(id),
      level: st?.level ?? 1,
      xp: st?.xp ?? 0,
      badges: Object.keys(badges),
      /** When each badge was earned (ms). */
      badgeTimes: badges,
      totalPlaytimeSeconds: games.reduce((sum, g) => sum + g.playtime_seconds, 0),
      gamesPlayed: games.length,
      top: games.slice(0, 25).map(shape),
      recent: [...games]
        .filter((g) => g.last_played_at)
        .sort((a, b) => (toMs(b.last_played_at) ?? 0) - (toMs(a.last_played_at) ?? 0))
        .slice(0, 8)
        .map(shape),
      memberSince: toMs(user2?.created_at),
      friendsSince: toMs(since?.created_at),
      friendCount: counts?.friends ?? 0,
      mutualFriends: counts?.mutual ?? 0,
      launches: perGame.reduce((sum, g) => sum + (g.launches ?? 0), 0),
      daysPlayed: streaks.days,
      currentStreak: streaks.current,
      bestStreak: streaks.best,
      favorites: games.filter((g) => pref.get(g.game_key)?.favorite).slice(0, 12).map(shape),
      finished: prefs.filter((p) => p.play_status === 'beaten' || p.play_status === 'completed').length,
      playing: games.filter((g) => pref.get(g.game_key)?.play_status === 'playing').slice(0, 6).map(shape),
      averageRating: rated.length ? Math.round((rated.reduce((sum, p) => sum + (p.user_rating ?? 0), 0) / rated.length) * 10) / 10 : null,
      ratedGames: rated.length,
      steam: steamLink ? { name: steamLink.display_name, profileUrl: steamLink.profile_url } : null,
      messages: { sent: mine?.sent ?? 0, received: mine?.received ?? 0, firstAt: toMs(mine?.first_at) },
      id,
      isFriend: friends && viewer !== id
    })
  }
  app.get('/friends/:id/stats', requireAuth, requireUser, playerStats)
  app.get('/users/:id/stats', requireAuth, requireUser, playerStats)

  /** Finds players by the start of their username (to view their profile or add them). */
  app.get('/users/search', requireAuth, requireUser, rateLimit, async (c) => {
    const q = (c.req.query('q') ?? '').trim()
    if (!/^[A-Za-z0-9_]{1,20}$/.test(q)) return c.json({ users: [] })
    const me = c.get('userId')
    const rows = await sql<{ id: string; username: string; avatar: string | null; style: unknown }>`
      SELECT id, username, avatar, style FROM vanity.profiles
      WHERE lower(username) LIKE ${q.toLowerCase().replace(/_/g, '\\_') + '%'} AND id <> ${me} AND id NOT LIKE 'test-%'
      ORDER BY (lower(username) = ${q.toLowerCase()}) DESC, length(username), username LIMIT 10`
    return c.json({ users: rows.map((r) => publicUser(r)) })
  })

  // ---- messages between friends (kept for good) --------------------------------

  const sends = new Map<string, { count: number; reset: number }>()
  type MessageRow = { id: string | number; sender_id: string; body: string; created_at: unknown; read_at: unknown }
  const message = (m: MessageRow, me: string) => ({ id: Number(m.id), mine: m.sender_id === me, text: m.body, at: toMs(m.created_at), readAt: toMs(m.read_at) })

  /**
   * A page of the conversation with a friend, oldest first. `before` (a message id) pages back
   * through history; `after` asks only for what is newer than the last message you have.
   * Reading it marks their messages to you as read.
   */
  app.get('/friends/:id/messages', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const other = c.req.param('id')
    if (!(await areFriends(me, other))) fail(403, 'You can only message your friends.')
    const num = (v: string | undefined): number | null => (v && /^\d{1,15}$/.test(v) ? Number(v) : null)
    const before = num(c.req.query('before'))
    const after = num(c.req.query('after'))
    const limit = Math.min(100, Math.max(1, num(c.req.query('limit')) ?? 50))
    const rows =
      after !== null
        ? await sql<MessageRow>`SELECT id, sender_id, body, created_at, read_at FROM vanity.messages
            WHERE least(sender_id, recipient_id) = least(${me}, ${other}) AND greatest(sender_id, recipient_id) = greatest(${me}, ${other}) AND id > ${after}
            ORDER BY id ASC LIMIT ${limit + 1}`
        : await sql<MessageRow>`SELECT id, sender_id, body, created_at, read_at FROM vanity.messages
            WHERE least(sender_id, recipient_id) = least(${me}, ${other}) AND greatest(sender_id, recipient_id) = greatest(${me}, ${other})
              AND (${before}::bigint IS NULL OR id < ${before}::bigint)
            ORDER BY id DESC LIMIT ${limit + 1}`
    const more = rows.length > limit
    const page = rows.slice(0, limit)
    if (after === null) page.reverse()
    await sql`UPDATE vanity.messages SET read_at = now() WHERE recipient_id = ${me} AND sender_id = ${other} AND read_at IS NULL`
    // What they have read of yours, so "Seen" can be shown under your last message.
    const [seen] = await sql<{ id: string | number | null }>`SELECT MAX(id) AS id FROM vanity.messages WHERE sender_id = ${me} AND recipient_id = ${other} AND read_at IS NOT NULL`
    return c.json({ messages: page.map((m) => message(m, me)), more, seenUpTo: seen?.id == null ? null : Number(seen.id) })
  })

  app.post('/friends/:id/messages', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const other = c.req.param('id')
    if (!(await areFriends(me, other))) fail(403, 'You can only message your friends.')
    const { text } = await body<{ text: string }>(c)
    // Line breaks are kept; other control characters are dropped.
    const clean = typeof text === 'string' ? text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim() : ''
    if (!clean) fail(400, 'Write a message first.')
    if ([...clean].length > MAX_MESSAGE) fail(400, `Messages can be up to ${MAX_MESSAGE.toLocaleString('en-US')} characters.`)
    if (!validGifText(clean)) fail(400, "That GIF can't be sent.")
    canSpeak(me)
    const t = Date.now()
    const s = sends.get(me)
    if (!s || s.reset < t) sends.set(me, { count: 1, reset: t + 60_000 })
    else if (++s.count > messageRateLimit) fail(429, "You're sending messages very fast. Wait a moment and try again.")
    const [row] = await sql<MessageRow>`INSERT INTO vanity.messages (sender_id, recipient_id, body) VALUES (${me}, ${other}, ${clean})
      RETURNING id, sender_id, body, created_at, read_at`
    return c.json({ message: message(row, me) }, 201)
  })

  /** Friends who have played a game (by Vanity's game key). */
  app.get('/games/:key/friends', requireAuth, requireUser, async (c) => {
    const me = c.get('userId')
    const rows = await sql<{ id: string; username: string; avatar: string | null; style: unknown; playtime_seconds: number; last_played_at: unknown }>`
      SELECT u.id, u.username, u.avatar, u.style, s.playtime_seconds, s.last_played_at
      FROM vanity.friendships f
      JOIN vanity.profiles u ON u.id = CASE WHEN f.requester_id = ${me} THEN f.addressee_id ELSE f.requester_id END
      JOIN vanity.game_stats s ON s.user_id = u.id AND s.game_key = ${c.req.param('key')} AND s.playtime_seconds > 0
      WHERE f.status = 'accepted' AND (f.requester_id = ${me} OR f.addressee_id = ${me})
      ORDER BY s.playtime_seconds DESC`
    return c.json({
      friends: rows.map((r) => ({ ...publicUser(r), playtimeSeconds: r.playtime_seconds, lastPlayedAt: toMs(r.last_played_at) }))
    })
  })

  // ---- voice rooms (see voice.ts) ---------------------------------------------
  const chats = groupRoutes({ sql, requireAuth, requireUser, areFriends, publicUser, canSpeak, klipyKey, fetchFn: fetchFn ?? fetch, messageRateLimit, now })
  app.route('/groups', chats.groups)
  app.route('/gifs', chats.gifs)
  app.route('/media', chats.media)
  app.route('/voice', voiceRoutes({ sql, requireAuth, requireUser, areFriends, publicUser, canSpeak, ice: voiceIce ?? iceConfigFromEnv({}), rateLimit: voiceRateLimit, now }))

  const coins = coinRoutes({ sql, requireAuth, requireUser, stripe, fetchFn: (fetchFn ?? fetch) as typeof fetch, now: clock, origin })
  app.route('/coins', coins.routes)
  app.route('/stripe', coins.webhook)
  app.route('/', commentRoutes({ sql, requireAuth, requireUser, publicUser, canSpeak, mayModerate: (id, author) => people.rolesOf(id).admin && people.mayActAgainst(id, author), now: clock }))
  app.route('/communities', communityRoutes({ sql, requireAuth, requireUser, publicUser, canSpeak, isVanityAdmin: (id) => people.rolesOf(id).admin, messageRateLimit, now: clock }))
  app.route('/admin', adminRoutes({ sql, requireAuth, requireUser, requireAdmin, people, publicUser, emailOf, grant: coins.grant, now: clock, logAdmin, problems, usernameChangeAt: async (id) => (await usernameChange(id)).usernameChangeAt, giftPlus: coins.giftPlus, plusOf: coins.plusOf }))

  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message, ...(typeof err.cause === 'string' ? { code: err.cause } : {}) }, err.status)
    console.error('[vanity-api]', err)
    return c.json({ error: 'Something went wrong on the server.' }, 500)
  })

  // Serve every route at /… and at /api/…, so the server works on its own domain
  // or behind a site that forwards /api/* to it (e.g. Vercel services).
  const root = new Hono<Env>()
  root.route('/api', app)
  root.route('/', app)
  return root
}
