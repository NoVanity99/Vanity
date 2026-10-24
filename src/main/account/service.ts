import type { AccountState, Settings } from '@shared/types'
import type { LibraryStore } from '../library/store'
import type { FetchFn } from '../metadata/http'
import { AccountClient, AccountError } from './client'
import { gameKey } from './gameKey'

const HEARTBEAT_MS = 60_000
const STATS_SYNC_MS = 15 * 60_000

export interface AccountDeps {
  store: LibraryStore
  fetchFn: FetchFn
  getSettings(): Settings
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  serverUrl(): string
  /** The game currently running, if any (from the session tracker). */
  runningGame(): { id: number; startedAt: number } | null
  onChange(state: AccountState): void
}

/**
 * Signs in to the Vanity account server and keeps it informed: a presence
 * heartbeat (what you're playing) about once a minute, and playtime stats
 * after sessions and every 15 minutes. Network trouble is retried quietly.
 */
export class AccountService {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null

  constructor(private deps: AccountDeps) {}

  client(): AccountClient {
    const s = this.deps.getSettings()
    return new AccountClient(this.deps.serverUrl(), this.deps.fetchFn, s.accountToken || null)
  }

  state(): AccountState {
    const s = this.deps.getSettings()
    const url = this.deps.serverUrl()
    return { serverConfigured: !!url, serverUrl: url, signedIn: !!s.accountToken && !!url, username: s.accountToken ? s.accountUsername || null : null }
  }

  private emit(): void {
    this.deps.onChange(this.state())
  }

  async setServer(url: string): Promise<AccountState> {
    const clean = url.trim().replace(/\/+$/, '')
    if (clean && !/^https?:\/\/[^\s]+$/i.test(clean)) throw new AccountError('Enter a full address, like https://your-project.vercel.app')
    if (clean) await new AccountClient(clean, this.deps.fetchFn).ping()
    // A different server means a different account.
    await this.deps.saveSettings({ accountServerUrl: clean, accountToken: '', accountUsername: '' })
    this.stop()
    this.emit()
    return this.state()
  }

  async register(username: string, password: string): Promise<AccountState> {
    return this.signedIn(await this.client().register(username, password))
  }

  async login(username: string, password: string): Promise<AccountState> {
    return this.signedIn(await this.client().login(username, password))
  }

  private async signedIn(session: { token: string; user: { username: string } }): Promise<AccountState> {
    await this.deps.saveSettings({ accountToken: session.token, accountUsername: session.user.username })
    this.start()
    this.emit()
    return this.state()
  }

  async logout(): Promise<AccountState> {
    await this.client().signOff().catch(() => {})
    await this.clearSession()
    return this.state()
  }

  async deleteAccount(): Promise<AccountState> {
    await this.client().deleteAccount()
    await this.clearSession()
    return this.state()
  }

  private async clearSession(): Promise<void> {
    this.stop()
    await this.deps.saveSettings({ accountToken: '', accountUsername: '' })
    this.emit()
  }

  /** Runs an account call; an invalid session signs out locally, other errors pass through. */
  async guard<T>(fn: (c: AccountClient) => Promise<T>): Promise<T> {
    if (!this.state().signedIn) throw new AccountError('Sign in to your Vanity account first.', true)
    try {
      return await fn(this.client())
    } catch (err) {
      if (err instanceof AccountError && err.signedOut) await this.clearSession()
      throw err
    }
  }

  // ---- background sync ------------------------------------------------------

  start(): void {
    if (!this.state().signedIn) return
    this.stop()
    void this.heartbeat()
    void this.syncStats()
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS)
    this.statsTimer = setInterval(() => void this.syncStats(), STATS_SYNC_MS)
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.heartbeatTimer = this.statsTimer = null
  }

  /** Tells the server what you're playing (or that you're online). Never throws. */
  async heartbeat(): Promise<void> {
    if (!this.state().signedIn) return
    const running = this.deps.runningGame()
    const game = running ? this.deps.store.get(running.id) : null
    await this.guard((c) => c.heartbeat(game ? { gameKey: gameKey(game.name), gameName: game.name, startedAt: running!.startedAt } : null)).catch(() => {})
  }

  /** Uploads playtime for every game you've played. Never throws. */
  async syncStats(): Promise<void> {
    if (!this.state().signedIn) return
    const games = this.deps.store
      .list()
      .filter((g) => g.playtimeSeconds > 0 || g.lastPlayedAt)
      .map((g) => ({ gameKey: gameKey(g.name), gameName: g.name, playtimeSeconds: g.playtimeSeconds, lastPlayedAt: g.lastPlayedAt }))
    // Several library entries can be the same game (e.g. Steam and GOG copies): add them up.
    const merged = new Map<string, (typeof games)[number]>()
    for (const g of games) {
      const prev = merged.get(g.gameKey)
      merged.set(
        g.gameKey,
        prev
          ? { ...prev, playtimeSeconds: prev.playtimeSeconds + g.playtimeSeconds, lastPlayedAt: Math.max(prev.lastPlayedAt ?? 0, g.lastPlayedAt ?? 0) || null }
          : g
      )
    }
    if (merged.size === 0) return
    await this.guard((c) => c.syncStats([...merged.values()].slice(0, 5000))).catch(() => {})
  }

  /** A game started or stopped: update presence now, and stats after a session ends. */
  onSessionChange(state: 'launching' | 'running' | 'stopped'): void {
    if (state === 'running' || state === 'stopped') void this.heartbeat()
    if (state === 'stopped') void this.syncStats()
  }

  /** Called when quitting: mark offline, waiting at most `ms`. */
  async signOffQuickly(ms = 1500): Promise<void> {
    if (!this.state().signedIn) return
    this.stop()
    await Promise.race([this.client().signOff().catch(() => {}), new Promise((r) => setTimeout(r, ms))])
  }
}
