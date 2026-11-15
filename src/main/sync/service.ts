import { SYNC_LIMITS, SYNCED_SETTINGS, type SyncCollections, type SyncedSettingKey, type SyncPrefs, type SyncRequest, type SyncResponse, type SyncSettings } from '@shared/sync'
import { PLAY_STATUSES, type PlayStatus, type Progress, type Settings, type SyncState } from '@shared/types'
import { AccountError } from '../account/errors'
import { gameKey } from '../account/gameKey'
import type { AccountService } from '../account/service'
import type { Db } from '../db/database'
import { createKv, type Kv } from '../db/kv'
import { computeProgress, KV, localDays, localGames, localLaunches, saveBadges, unlockedBadges, type CloudOnlyGame, type LocalGameRow } from './progress'

const SYNC_EVERY_MS = 10 * 60_000
const RETRY_OFFLINE_MS = 60_000
/** After a change on this device, wait this long (for more changes) before syncing. */
const DEBOUNCE_MS = 4000

export interface SyncDeps {
  db: Db
  account: AccountService
  getSettings(): Settings
  /** Saves settings that arrived from another device (and tells the screens). */
  applySettings(patch: Partial<Settings>): Promise<void>
  /** A name for this device, shown in the Neon console only (e.g. "Windows PC", "Android phone"). */
  deviceName: string
  onChange(progress: Progress): void
  now?: () => number
  /** A random id; injectable for tests. */
  newId?: () => string
}

function randomId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Cloud-saved progress. The local database is always the working copy, so everything works
 * offline; this service sends what the device knows to the Vanity server and merges what comes
 * back. There is nothing to "queue": whatever changed while offline is simply part of the next sync.
 */
export class SyncService {
  private kv: Kv
  private state: SyncState = { status: 'local', lastSyncedAt: null, message: null, appliedAt: 0 }
  private running: Promise<void> | null = null
  private again = false
  private debounce: ReturnType<typeof setTimeout> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null

  constructor(private deps: SyncDeps) {
    this.kv = createKv(deps.db, () => this.now())
    this.state.lastSyncedAt = this.kv.get<number>(KV.lastSyncedAt)
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private canSync(): boolean {
    return !!this.deps.account.state().username
  }

  /** Level, XP, badges and totals, from what this device knows right now. */
  progress(): Progress {
    if (!this.canSync() && this.state.status !== 'local') this.state = { ...this.state, status: 'local', message: null }
    return computeProgress(this.deps.db, this.kv, { ...this.state }, this.now())
  }

  private emit(): void {
    this.deps.onChange(this.progress())
  }

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.syncNow(), SYNC_EVERY_MS)
    void this.syncNow()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
    if (this.retry) clearTimeout(this.retry)
    this.timer = this.debounce = this.retry = null
  }

  /** Something changed on this device (a session ended, a favourite was toggled…): sync soon. */
  touch(): void {
    this.emit()
    if (!this.canSync()) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      void this.syncNow()
    }, DEBOUNCE_MS)
  }

  /** The user changed collections here: theirs is now the newest copy. */
  collectionsChanged(): void {
    this.kv.set(KV.collectionsAt, this.now())
    this.touch()
  }

  /** Call after settings are saved by the user; notes the time if a synced setting changed. */
  settingsChanged(before: Settings, after: Settings): void {
    if (!SYNCED_SETTINGS.some((k) => before[k] !== after[k])) return
    this.kv.set(KV.settingsAt, this.now())
    this.touch()
  }

  /** Signed in, signed out, or switched account. */
  accountChanged(): void {
    if (this.canSync()) void this.syncNow()
    else this.set({ status: 'local', message: null })
  }

  // ---- what this device sends ---------------------------------------------------

  private deviceId(): string {
    let id = this.kv.get<string>(KV.deviceId)
    if (!id) {
      id = (this.deps.newId ?? randomId)()
      this.kv.set(KV.deviceId, id)
    }
    return id
  }

  private localCollections(rows: LocalGameRow[]): SyncCollections | null {
    const at = this.kv.get<number>(KV.collectionsAt)
    const keyOf = new Map(rows.map((r) => [r.id, gameKey(r.name)]))
    const orphans = this.kv.get<Record<string, string[]>>(KV.orphans) ?? {}
    const members = this.deps.db.prepare('SELECT c.id AS id, c.name AS name, cg.game_id AS game_id FROM collections c LEFT JOIN collection_games cg ON cg.collection_id = c.id ORDER BY c.id').all() as { id: number; name: string; game_id: number | null }[]
    const byName = new Map<string, Set<string>>()
    for (const m of members) {
      const set = byName.get(m.name) ?? new Set<string>(orphans[String(m.id)] ?? [])
      byName.set(m.name, set)
      const key = m.game_id === null ? null : keyOf.get(m.game_id)
      if (key) set.add(key)
    }
    // Never changed here and nothing to offer: only receive.
    if (!at && byName.size === 0) return null
    return { updatedAt: at ?? 1, items: [...byName].map(([name, games]) => ({ name, games: [...games].slice(0, SYNC_LIMITS.collectionGames) })) }
  }

  private localSettings(): SyncSettings | null {
    const at = this.kv.get<number>(KV.settingsAt)
    if (!at) return null
    const s = this.deps.getSettings()
    return { updatedAt: at, values: Object.fromEntries(SYNCED_SETTINGS.map((k) => [k, s[k]])) as SyncSettings['values'] }
  }

  buildRequest(): SyncRequest {
    const rows = localGames(this.deps.db)
    const games = new Map<string, SyncRequest['games'][number]>()
    const prefs = new Map<string, SyncPrefs>()
    for (const r of rows) {
      const key = gameKey(r.name)
      const launches = localLaunches(r)
      if (r.playtime_seconds > 0 || launches > 0) {
        const prev = games.get(key)
        // Several library entries can be the same game (a Steam and a GOG copy): add them up.
        games.set(key, {
          key,
          name: prev?.name ?? r.name,
          playtimeSeconds: (prev?.playtimeSeconds ?? 0) + r.playtime_seconds,
          launches: (prev?.launches ?? 0) + launches,
          lastPlayedAt: Math.max(prev?.lastPlayedAt ?? 0, r.last_played_at ?? 0) || null,
          firstPlayedAt: Math.min(prev?.firstPlayedAt ?? Infinity, r.first_session ?? r.last_played_at ?? Infinity) || null
        })
        const g = games.get(key)!
        if (g.firstPlayedAt === Infinity) g.firstPlayedAt = null
      }
      if (r.user_updated_at > 0) {
        const prev = prefs.get(key)
        if (!prev || r.user_updated_at > prev.updatedAt) {
          prefs.set(key, { key, favorite: r.favorite === 1, playStatus: r.play_status, userRating: r.user_rating, notes: r.notes ? r.notes.slice(0, SYNC_LIMITS.notes) : null, updatedAt: r.user_updated_at })
        }
      }
    }
    const progress = this.progress()
    return {
      deviceId: this.deviceId(),
      deviceName: this.deps.deviceName,
      games: [...games.values()].slice(0, SYNC_LIMITS.games),
      prefs: [...prefs.values()].slice(0, SYNC_LIMITS.games),
      days: [...new Set([...(this.kv.get<string[]>(KV.days) ?? []), ...localDays(this.deps.db)])].sort().slice(-SYNC_LIMITS.days),
      badges: unlockedBadges(this.deps.db),
      collections: this.localCollections(rows),
      settings: this.localSettings(),
      summary: { xp: progress.xp, level: progress.level.level }
    }
  }

  // ---- what comes back ------------------------------------------------------------

  /** Merges the server's answer into the local database. Returns true if anything visible changed. */
  private async apply(res: SyncResponse): Promise<boolean> {
    const db = this.deps.db
    let changed = false
    let settingsPatch: Partial<Settings> | null = null

    db.transaction(() => {
      const rows = localGames(db)
      const byKey = new Map<string, LocalGameRow[]>()
      for (const r of rows) {
        const key = gameKey(r.name)
        byKey.set(key, [...(byKey.get(key) ?? []), r])
      }

      // Counters from your other devices. Only the first copy of a game carries them, so totals aren't doubled.
      const setCloud = db.prepare('UPDATE games SET cloud_playtime_seconds = ?, cloud_launches = ?, last_played_at = ? WHERE id = ?')
      const cloudByKey = new Map(res.games.map((g) => [g.key, g]))
      for (const [key, copies] of byKey) {
        const cloud = cloudByKey.get(key)
        copies.forEach((r, i) => {
          const seconds = i === 0 ? (cloud?.otherPlaytimeSeconds ?? 0) : 0
          const launches = i === 0 ? (cloud?.otherLaunches ?? 0) : 0
          const last = i === 0 ? Math.max(r.last_played_at ?? 0, cloud?.lastPlayedAt ?? 0) || null : r.last_played_at
          if (seconds !== r.cloud_playtime_seconds || launches !== r.cloud_launches || last !== r.last_played_at) {
            setCloud.run(seconds, launches, last, r.id)
            changed = true
          }
        })
      }

      // Your choices: after the merge the server holds the winner. A change made here since the
      // request was built is newer than it and is kept (it goes up with the next sync).
      const setPrefs = db.prepare('UPDATE games SET favorite = ?, play_status = ?, user_rating = ?, notes = ?, user_updated_at = ? WHERE id = ?')
      const prefsByKey = new Map(res.prefs.map((p) => [p.key, p]))
      for (const [key, copies] of byKey) {
        const p = prefsByKey.get(key)
        if (!p) continue
        const status = PLAY_STATUSES.includes(p.playStatus as PlayStatus) ? p.playStatus : null
        for (const r of copies) {
          if (p.updatedAt < r.user_updated_at) continue
          const same = (r.favorite === 1) === p.favorite && r.play_status === status && r.user_rating === p.userRating && (r.notes ?? null) === (p.notes ?? null)
          if (same && r.user_updated_at === p.updatedAt) continue
          setPrefs.run(p.favorite ? 1 : 0, status, p.userRating, p.notes, p.updatedAt, r.id)
          if (!same) changed = true
        }
      }

      // Games you only have on another device: kept for the profile page and your totals.
      const cloudOnly: CloudOnlyGame[] = res.games
        .filter((g) => !byKey.has(g.key))
        .map((g) => {
          const p = prefsByKey.get(g.key)
          return { ...g, favorite: p?.favorite, playStatus: p?.playStatus, userRating: p?.userRating }
        })
      if (JSON.stringify(cloudOnly) !== JSON.stringify(this.kv.get(KV.cloudOnly) ?? [])) {
        this.kv.set(KV.cloudOnly, cloudOnly)
        changed = true
      }

      if (JSON.stringify(res.days) !== JSON.stringify(this.kv.get(KV.days) ?? [])) {
        this.kv.set(KV.days, res.days)
        changed = true
      }

      const before = JSON.stringify(unlockedBadges(db))
      saveBadges(db, res.badges)
      if (JSON.stringify(unlockedBadges(db)) !== before) changed = true

      // Collections: replaced as a whole when the server's copy is newer than this device's.
      const localAt = this.kv.get<number>(KV.collectionsAt) ?? 0
      if (res.collections && res.collections.updatedAt > localAt) {
        db.prepare('DELETE FROM collections').run()
        const addCollection = db.prepare('INSERT INTO collections (name, created_at) VALUES (?, ?)')
        const addMember = db.prepare('INSERT OR IGNORE INTO collection_games (collection_id, game_id, added_at) VALUES (?, ?, ?)')
        const orphans: Record<string, string[]> = {}
        for (const c of res.collections.items) {
          const id = Number(addCollection.run(c.name, this.now()).lastInsertRowid)
          for (const key of c.games) {
            const copies = byKey.get(key)
            if (copies) for (const r of copies) addMember.run(id, r.id, this.now())
            else (orphans[String(id)] ??= []).push(key)
          }
        }
        this.kv.set(KV.orphans, orphans)
        this.kv.set(KV.collectionsAt, res.collections.updatedAt)
        changed = true
      }

      const settingsAt = this.kv.get<number>(KV.settingsAt) ?? 0
      if (res.settings && res.settings.updatedAt > settingsAt) {
        const current = this.deps.getSettings()
        const patch: Record<string, unknown> = {}
        for (const key of SYNCED_SETTINGS) {
          const v = res.settings.values[key as SyncedSettingKey]
          if (v !== undefined && typeof v === typeof current[key] && v !== current[key]) patch[key] = v
        }
        this.kv.set(KV.settingsAt, res.settings.updatedAt)
        if (Object.keys(patch).length) settingsPatch = patch as Partial<Settings>
      }
    })()

    if (settingsPatch) {
      await this.deps.applySettings(settingsPatch)
      changed = true
    }
    return changed
  }

  /** A different account on this device: what the cloud told us about the previous one no longer applies. */
  private forgetCloudCopy(): void {
    this.deps.db.prepare('UPDATE games SET cloud_playtime_seconds = 0, cloud_launches = 0').run()
    for (const key of [KV.cloudOnly, KV.days, KV.orphans, KV.lastSyncedAt]) this.kv.delete(key)
  }

  /** Syncs now (or right after the sync that is already running). Never throws. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      // A change during the sync, or a level that rose by merging, needs one more pass (a few at most).
      for (let pass = 0; pass < 3; pass++) {
        this.again = false
        await this.run()
        if (!this.again) break
      }
      this.again = false
    })().finally(() => (this.running = null))
    return this.running
  }

  private async run(): Promise<void> {
    await this.deps.account.load()
    if (!this.canSync()) {
      this.set({ status: 'local', message: null })
      return
    }
    if (this.retry) clearTimeout(this.retry)
    this.retry = null

    const who = this.deps.account.state().email ?? this.deps.account.state().username ?? ''
    const previous = this.kv.get<string>(KV.account)
    if (previous && previous !== who) this.forgetCloudCopy()
    this.kv.set(KV.account, who)

    this.set({ status: 'syncing', message: null })
    try {
      const request = this.buildRequest()
      const response = await this.deps.account.guard((c) => c.sync(request))
      const changed = await this.apply(response)
      const at = this.now()
      this.kv.set(KV.lastSyncedAt, at)
      this.set({ status: 'synced', lastSyncedAt: at, message: null, appliedAt: changed ? at : this.state.appliedAt })
      // Merging may have raised the level (playtime from another device): tell the server the new numbers.
      if (this.progress().xp !== request.summary.xp) this.again = true
    } catch (err) {
      if (err instanceof AccountError && err.signedOut) {
        this.set({ status: 'local', message: null })
      } else if (err instanceof AccountError && err.offline) {
        this.set({ status: 'offline', message: "You're offline. Your progress is saved on this device and will sync when you're back online." })
        this.retry = setTimeout(() => void this.syncNow(), RETRY_OFFLINE_MS)
      } else {
        console.warn('[sync]', err)
        this.set({ status: 'error', message: err instanceof Error ? err.message : 'Sync failed. Vanity will try again.' })
      }
    }
  }
}
