import type { SteamAchievement, SteamGame, SteamLink, SteamState } from '@shared/types'
import { AccountError } from '../account/errors'
import type { AccountService } from '../account/service'
import type { Db } from '../db/database'
import { createKv, type Kv } from '../db/kv'
import { KV } from '../sync/progress'

const STATE_KEY = 'steam:state'
const REFRESH_EVERY_MS = 30 * 60_000
/** While Steam achievements are still being counted on the server, ask again this often. */
const COUNTING_RETRY_MS = 20_000
const SIGN_IN_POLL_MS = 2500
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

export interface SteamDeps {
  db: Db
  account: AccountService
  /** Opens a web address in the system browser. */
  openExternal(url: string): Promise<void>
  /** The linked account's games (null: unlinked, signed out, or not shared). Used to show owned games in the library. */
  onOwnedGames?(games: SteamGame[] | null): void
  /** Achievement XP changed: recompute progress (and sync). */
  onProgress(): void
  onChange(state: SteamState): void
  now?: () => number
  /** Replaceable waiting, for tests. */
  sleep?: (ms: number) => Promise<void>
}

const EMPTY: SteamState = { available: false, configured: null, link: null, gamesPrivate: false, privateMessage: null, ownedGames: null, achievements: null, signingIn: false, error: null }

/**
 * Your linked Steam account. Vanity never holds the Steam Web API key: every question goes to the
 * Vanity server, which adds the key, asks Steam, and answers. This keeps the last answer so the
 * Account page has something to show offline, and feeds your achievement count into your XP.
 */
export class SteamService {
  private kv: Kv
  private s: SteamState
  private refreshing: Promise<SteamState> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private signInRun = 0

  constructor(private deps: SteamDeps) {
    this.kv = createKv(deps.db, deps.now)
    const saved = this.kv.get<SteamState>(STATE_KEY)
    this.s = { ...EMPTY, ...(saved ?? {}), signingIn: false, error: null }
  }

  private get signedIn(): boolean {
    return !!this.deps.account.state().username
  }

  state(): SteamState {
    return { ...this.s, available: this.signedIn }
  }

  private set(patch: Partial<SteamState>): void {
    this.s = { ...this.s, ...patch }
    this.kv.set(STATE_KEY, { ...this.s, signingIn: false, error: null })
    this.deps.onChange(this.state())
  }

  private setAchievements(unlocked: number): void {
    if ((this.kv.get<number>(KV.steamAchievements) ?? 0) === unlocked) return
    this.kv.set(KV.steamAchievements, unlocked)
    this.deps.onProgress()
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.refresh(), REFRESH_EVERY_MS)
    void this.refresh()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.retry) clearTimeout(this.retry)
    this.timer = this.retry = null
    this.signInRun++
  }

  /** Signed in or out of Vanity: a different account has a different Steam link. */
  accountChanged(): void {
    if (!this.signedIn) {
      this.signInRun++
      this.s = { ...EMPTY }
      this.kv.delete(STATE_KEY)
      this.setAchievements(0)
      this.deps.onOwnedGames?.(null)
      this.deps.onChange(this.state())
      return
    }
    void this.refresh()
  }

  /** Asks the server for the link, the size of the library and the achievement count. Never throws. */
  refresh(): Promise<SteamState> {
    this.refreshing ??= this.run().finally(() => (this.refreshing = null))
    return this.refreshing
  }

  private async run(): Promise<SteamState> {
    await this.deps.account.load()
    if (!this.signedIn) return this.state()
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    try {
      const { configured, link } = await this.deps.account.guard((c) => c.steamLink())
      if (!link) {
        this.set({ configured, link: null, gamesPrivate: false, privateMessage: null, ownedGames: null, achievements: null, error: null })
        this.setAchievements(0)
        this.deps.onOwnedGames?.(null)
        return this.state()
      }
      this.set({ configured, link, error: null })
      await this.loadGames()
    } catch (err) {
      // Offline or a server hiccup: keep showing what we knew.
      if (!(err instanceof AccountError && (err.offline || err.signedOut))) this.set({ error: err instanceof Error ? err.message : 'Could not reach Steam.' })
    }
    return this.state()
  }

  /** Library size and achievements for the linked account, noticing when Steam isn't sharing them. */
  private async loadGames(): Promise<void> {
    try {
      const summary = await this.deps.account.guard((c) => c.steamAchievementSummary())
      this.set({ gamesPrivate: false, privateMessage: null, ownedGames: summary.gamesTotal, achievements: { unlocked: summary.unlocked, total: summary.total, complete: summary.complete } })
      this.setAchievements(summary.unlocked)
      const owned = await this.deps.account.guard((c) => c.steamOwnedGames()).catch(() => null)
      if (owned) {
        this.set({ ownedGames: owned.length })
        this.deps.onOwnedGames?.(owned)
      }
      // A big library is counted a batch at a time: keep asking until it's done.
      if (!summary.complete) this.retry = setTimeout(() => void this.refresh(), COUNTING_RETRY_MS)
    } catch (err) {
      if (err instanceof AccountError && err.code === 'steam_private') {
        this.set({ gamesPrivate: true, privateMessage: err.message, ownedGames: null, achievements: null })
        this.setAchievements(0)
        this.deps.onOwnedGames?.(null)
        return
      }
      throw err
    }
  }

  /** Links from a SteamID64, a profile link or a custom URL name. Throws with a message to show. */
  async link(input: string): Promise<SteamState> {
    const { link } = await this.deps.account.guard((c) => c.steamLinkSet(input))
    this.set({ link, gamesPrivate: false, privateMessage: null, ownedGames: null, achievements: null, error: null })
    await this.loadGames().catch((err) => this.set({ error: err instanceof Error ? err.message : null }))
    return this.state()
  }

  async unlink(): Promise<SteamState> {
    await this.deps.account.guard((c) => c.steamUnlink())
    this.signInRun++
    this.set({ link: null, gamesPrivate: false, privateMessage: null, ownedGames: null, achievements: null, signingIn: false, error: null })
    this.setAchievements(0)
    this.deps.onOwnedGames?.(null)
    return this.state()
  }

  /**
   * "Sign in through Steam": opens Steam's own sign-in page in the browser. Vanity never sees the
   * Steam password; Steam tells the Vanity server which account signed in, and the server links it.
   * Resolves once the browser is open; the link appears when the user finishes (or it gives up).
   */
  async signIn(): Promise<SteamState> {
    const before = this.s.link
    const { url } = await this.deps.account.guard((c) => c.steamOpenIdStart())
    if (!/^https:\/\/steamcommunity\.com\/openid\/login\?/.test(url)) throw new AccountError("The server sent an address that isn't Steam's sign-in page.")
    await this.deps.openExternal(url)
    const run = ++this.signInRun
    this.set({ signingIn: true, error: null })
    void this.waitForSignIn(run, before)
    return this.state()
  }

  cancelSignIn(): SteamState {
    this.signInRun++
    if (this.s.signingIn) this.set({ signingIn: false })
    return this.state()
  }

  private async waitForSignIn(run: number, before: SteamLink | null): Promise<void> {
    const now = this.deps.now ?? Date.now
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const deadline = now() + SIGN_IN_TIMEOUT_MS
    while (run === this.signInRun && now() < deadline) {
      await sleep(SIGN_IN_POLL_MS)
      if (run !== this.signInRun) return
      try {
        const { link } = await this.deps.account.guard((c) => c.steamLink())
        if (link?.verified && (link.steamId !== before?.steamId || !before?.verified || link.linkedAt !== before.linkedAt)) {
          this.set({ link, signingIn: false, gamesPrivate: false, privateMessage: null })
          await this.loadGames().catch(() => {})
          return
        }
      } catch {
        // Keep waiting: the browser part may still be going on.
      }
    }
    if (run === this.signInRun) this.set({ signingIn: false, error: "Steam sign-in wasn't finished. Try again, or paste your SteamID instead." })
  }

  ownedGames = (): Promise<SteamGame[]> => this.deps.account.guard((c) => c.steamOwnedGames())
  recentGames = (): Promise<SteamGame[]> => this.deps.account.guard((c) => c.steamRecentGames())
  achievements = (appId: number): Promise<SteamAchievement[]> => this.deps.account.guard((c) => c.steamAchievements(appId))
}
