import type { CloudGame, SyncCollections, SyncPrefs, SyncRequest, SyncResponse, SyncSettings } from '../../src/shared/sync'
import type { Sql } from './db'

// Kept in step with SYNC_LIMITS and SYNCED_SETTINGS in src/shared/sync.ts (the server bundle
// only shares the types with the app, so the values are repeated here).
const LIMITS = { games: 5000, days: 6000, collections: 200, collectionGames: 5000, notes: 5000, badges: 200 }
const SETTING_KEYS = ['theme', 'font', 'ambientBackground', 'controllerEnabled', 'breakReminderMinutes', 'discordPresence', 'minimizeWhilePlaying']
const PLAY_STATUSES = ['backlog', 'playing', 'beaten', 'completed', 'dropped']
const DAY = /^\d{4}-\d{2}-\d{2}$/

export class SyncError extends Error {}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const int = (v: unknown, max = 2_000_000_000): number => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)))
const ms = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null)
const toMs = (v: unknown): number | null => (v instanceof Date ? v.getTime() : typeof v === 'string' && v ? Date.parse(v) : typeof v === 'number' ? v : null)
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}

function cleanCollections(c: unknown, now: number): SyncCollections | null {
  if (!c || typeof c !== 'object') return null
  const { updatedAt, items } = c as Partial<SyncCollections>
  if (!Array.isArray(items) || !ms(updatedAt)) return null
  const seen = new Set<string>()
  const out: SyncCollections['items'] = []
  for (const item of items.slice(0, LIMITS.collections)) {
    const name = str(item?.name, 60).trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const games = Array.isArray(item.games) ? [...new Set(item.games.filter((g) => typeof g === 'string' && g).map((g) => g.slice(0, 200)))].slice(0, LIMITS.collectionGames) : []
    out.push({ name, games })
  }
  // A clock set in the future can't make a change win forever.
  return { updatedAt: Math.min(ms(updatedAt)!, now), items: out }
}

function cleanSettings(s: unknown, now: number): SyncSettings | null {
  if (!s || typeof s !== 'object') return null
  const { updatedAt, values } = s as Partial<SyncSettings>
  if (!values || typeof values !== 'object' || !ms(updatedAt)) return null
  const out: Record<string, string | number | boolean> = {}
  for (const key of SETTING_KEYS) {
    const v = (values as Record<string, unknown>)[key]
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[key] = v
    else if (typeof v === 'string') out[key] = v.slice(0, 100)
  }
  return { updatedAt: Math.min(ms(updatedAt)!, now), values: out }
}

/**
 * Merges what a device knows into the account and answers with the merged result.
 * Nothing a device sends can lower a counter or remove a day or badge.
 */
export async function syncUser(sql: Sql, userId: string, body: Partial<SyncRequest>, now = Date.now()): Promise<SyncResponse> {
  const deviceId = str(body.deviceId, 64)
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) throw new SyncError('This device has no valid id.')
  if (!Array.isArray(body.games) || !Array.isArray(body.prefs) || !Array.isArray(body.days)) throw new SyncError('Expected games, prefs and days.')
  if (body.games.length > LIMITS.games || body.prefs.length > LIMITS.games) throw new SyncError(`At most ${LIMITS.games} games per sync.`)
  const deviceName = str(body.deviceName, 60) || 'Device'

  // ---- this device's counters (never lowered) ----
  const games = new Map<string, { name: string; seconds: number; launches: number; last: number | null; first: number | null }>()
  for (const g of body.games) {
    const key = str(g?.key, 200)
    if (!key || typeof g.name !== 'string') continue
    games.set(key, { name: g.name.slice(0, 200), seconds: int(g.playtimeSeconds, 1_000_000_000), launches: int(g.launches, 10_000_000), last: ms(g.lastPlayedAt), first: ms(g.firstPlayedAt) })
  }
  if (games.size) {
    const keys = [...games.keys()]
    const v = keys.map((k) => games.get(k)!)
    await sql`INSERT INTO vanity.device_games (user_id, device_id, game_key, game_name, playtime_seconds, launches, last_played_at, first_played_at, updated_at)
      SELECT ${userId}, ${deviceId}, t.k, t.n, t.p, t.c,
        CASE WHEN t.l IS NULL THEN NULL ELSE to_timestamp(t.l / 1000.0) END,
        CASE WHEN t.f IS NULL THEN NULL ELSE to_timestamp(t.f / 1000.0) END, now()
      FROM unnest(${keys}::text[], ${v.map((g) => g.name)}::text[], ${v.map((g) => g.seconds)}::int[], ${v.map((g) => g.launches)}::int[], ${v.map((g) => g.last)}::float8[], ${v.map((g) => g.first)}::float8[]) AS t(k, n, p, c, l, f)
      ON CONFLICT (user_id, device_id, game_key) DO UPDATE SET
        game_name = excluded.game_name,
        playtime_seconds = GREATEST(vanity.device_games.playtime_seconds, excluded.playtime_seconds),
        launches = GREATEST(vanity.device_games.launches, excluded.launches),
        last_played_at = GREATEST(vanity.device_games.last_played_at, excluded.last_played_at),
        first_played_at = LEAST(vanity.device_games.first_played_at, excluded.first_played_at),
        updated_at = now()`
  }

  // ---- your choices per game: the server's copy stays unless the device's is newer ----
  const prefs = new Map<string, SyncPrefs>()
  for (const p of body.prefs) {
    const key = str(p?.key, 200)
    const updatedAt = ms(p?.updatedAt)
    if (!key || !updatedAt) continue
    const rating = Number.isInteger(p.userRating) && p.userRating! >= 1 && p.userRating! <= 5 ? p.userRating : null
    prefs.set(key, {
      key,
      favorite: p.favorite === true,
      playStatus: typeof p.playStatus === 'string' && PLAY_STATUSES.includes(p.playStatus) ? p.playStatus : null,
      userRating: rating,
      notes: typeof p.notes === 'string' && p.notes.trim() ? p.notes.slice(0, LIMITS.notes) : null,
      updatedAt: Math.min(updatedAt, now)
    })
  }
  if (prefs.size) {
    const v = [...prefs.values()]
    await sql`INSERT INTO vanity.game_prefs (user_id, game_key, favorite, play_status, user_rating, notes, updated_at)
      SELECT ${userId}, t.k, t.f, t.s, t.r, t.n, t.u
      FROM unnest(${v.map((p) => p.key)}::text[], ${v.map((p) => p.favorite)}::boolean[], ${v.map((p) => p.playStatus)}::text[], ${v.map((p) => p.userRating)}::int[], ${v.map((p) => p.notes)}::text[], ${v.map((p) => p.updatedAt)}::bigint[]) AS t(k, f, s, r, n, u)
      ON CONFLICT (user_id, game_key) DO UPDATE SET
        favorite = excluded.favorite, play_status = excluded.play_status, user_rating = excluded.user_rating, notes = excluded.notes, updated_at = excluded.updated_at
      WHERE excluded.updated_at > vanity.game_prefs.updated_at`
  }

  // ---- account-wide state ----
  const [state] = await sql<{ days: unknown; badges: unknown; collections: unknown; collections_updated_at: string | number | null; settings: unknown; settings_updated_at: string | number | null }>`
    SELECT days, badges, collections, collections_updated_at, settings, settings_updated_at FROM vanity.user_state WHERE user_id = ${userId}`

  const days = [...new Set([...json<string[]>(state?.days, []), ...body.days.filter((d) => typeof d === 'string' && DAY.test(d))])].sort().slice(-LIMITS.days)

  const badges: Record<string, number> = { ...json<Record<string, number>>(state?.badges, {}) }
  if (body.badges && typeof body.badges === 'object') {
    for (const [id, at] of Object.entries(body.badges).slice(0, LIMITS.badges)) {
      const when = ms(at)
      if (!/^[a-z0-9-]{1,40}$/.test(id) || !when) continue
      // The earliest unlock is the true one.
      badges[id] = Math.min(badges[id] ?? Infinity, Math.min(when, now))
    }
  }

  let collections: SyncCollections | null = state?.collections ? { updatedAt: Number(state.collections_updated_at) || 0, items: json<SyncCollections['items']>(state.collections, []) } : null
  const incomingCollections = cleanCollections(body.collections, now)
  if (incomingCollections && incomingCollections.updatedAt > (collections?.updatedAt ?? 0)) collections = incomingCollections

  let settings: SyncSettings | null = state?.settings ? { updatedAt: Number(state.settings_updated_at) || 0, values: json<SyncSettings['values']>(state.settings, {}) } : null
  const incomingSettings = cleanSettings(body.settings, now)
  if (incomingSettings && incomingSettings.updatedAt > (settings?.updatedAt ?? 0)) settings = incomingSettings

  const xp = int(body.summary?.xp, 2_000_000_000)
  const level = int(body.summary?.level, 100_000) || 1
  await sql`INSERT INTO vanity.user_state (user_id, xp, level, days, badges, collections, collections_updated_at, settings, settings_updated_at, device_name, updated_at)
    VALUES (${userId}, ${xp}, ${level}, ${JSON.stringify(days)}::jsonb, ${JSON.stringify(badges)}::jsonb,
      ${collections ? JSON.stringify(collections.items) : null}::jsonb, ${collections?.updatedAt ?? null},
      ${settings ? JSON.stringify(settings.values) : null}::jsonb, ${settings?.updatedAt ?? null}, ${deviceName}, now())
    ON CONFLICT (user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, days = excluded.days, badges = excluded.badges,
      collections = excluded.collections, collections_updated_at = excluded.collections_updated_at,
      settings = excluded.settings, settings_updated_at = excluded.settings_updated_at, device_name = excluded.device_name, updated_at = now()`

  // ---- the merged picture ----
  const totals = await sql<{ game_key: string; game_name: string; total: number; launches: number; other: number; other_launches: number; last_played_at: unknown; first_played_at: unknown }>`
    SELECT game_key,
      (array_agg(game_name ORDER BY updated_at DESC))[1] AS game_name,
      SUM(playtime_seconds)::int AS total,
      SUM(launches)::int AS launches,
      COALESCE(SUM(playtime_seconds) FILTER (WHERE device_id <> ${deviceId}), 0)::int AS other,
      COALESCE(SUM(launches) FILTER (WHERE device_id <> ${deviceId}), 0)::int AS other_launches,
      MAX(last_played_at) AS last_played_at, MIN(first_played_at) AS first_played_at
    FROM vanity.device_games WHERE user_id = ${userId} GROUP BY game_key`
  const cloudGames: CloudGame[] = totals.map((t) => ({
    key: t.game_key,
    name: t.game_name,
    playtimeSeconds: t.total,
    launches: t.launches,
    otherPlaytimeSeconds: t.other,
    otherLaunches: t.other_launches,
    lastPlayedAt: toMs(t.last_played_at),
    firstPlayedAt: toMs(t.first_played_at)
  }))

  // What friends see is the total across devices.
  if (cloudGames.length) {
    const played = cloudGames.filter((g) => g.playtimeSeconds > 0 || g.lastPlayedAt)
    await sql`INSERT INTO vanity.game_stats (user_id, game_key, game_name, playtime_seconds, last_played_at, updated_at)
      SELECT ${userId}, t.k, t.n, t.p, CASE WHEN t.l IS NULL THEN NULL ELSE to_timestamp(t.l / 1000.0) END, now()
      FROM unnest(${played.map((g) => g.key)}::text[], ${played.map((g) => g.name)}::text[], ${played.map((g) => g.playtimeSeconds)}::int[], ${played.map((g) => g.lastPlayedAt)}::float8[]) AS t(k, n, p, l)
      ON CONFLICT (user_id, game_key) DO UPDATE SET game_name = excluded.game_name,
        playtime_seconds = excluded.playtime_seconds, last_played_at = excluded.last_played_at, updated_at = now()`
  }

  const storedPrefs = await sql<{ game_key: string; favorite: boolean; play_status: string | null; user_rating: number | null; notes: string | null; updated_at: string | number }>`
    SELECT game_key, favorite, play_status, user_rating, notes, updated_at FROM vanity.game_prefs WHERE user_id = ${userId}`

  return {
    serverTime: now,
    games: cloudGames,
    prefs: storedPrefs.map((p) => ({ key: p.game_key, favorite: p.favorite, playStatus: p.play_status, userRating: p.user_rating, notes: p.notes, updatedAt: Number(p.updated_at) })),
    days,
    badges,
    collections,
    settings
  }
}
