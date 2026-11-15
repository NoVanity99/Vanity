import type { BackendConfig } from '@shared/backend'
import { normalizeProfileStyle, type ProfileStyle } from '../../shared/profileStyle'
import type { AccountState } from '@shared/types'
import type { LibraryStore } from '../library/store'
import type { FetchFn } from '../metadata/http'
import { AccountClient, type Me } from './client'
import { AccountError } from './errors'
import { gameKey } from './gameKey'
import { jwtExpiry, NeonAuth, type AuthHttp, type AuthSession } from './neonAuth'

const HEARTBEAT_MS = 60_000
const STATS_SYNC_MS = 15 * 60_000
/** A token this close to running out is replaced before it is used. */
const TOKEN_MARGIN_MS = 60_000
const USERNAME = /^[A-Za-z0-9_]{3,20}$/

/** What is kept between launches. The cookie is the secret part. */
export interface SavedSession {
  cookie: string
  userId: string
  email: string
  /** Null until the account has picked a username. */
  username: string | null
  /** The profile as last seen from the server, so it shows offline too. */
  avatar?: string | null
  bio?: string
  style?: ProfileStyle
  verified?: boolean
  admin?: boolean
}

/** The parts of the server's answer that are kept with the session. */
const profileOf = (me: Me): Pick<SavedSession, 'username' | 'avatar' | 'bio' | 'style' | 'verified' | 'admin'> => ({
  username: me.username,
  avatar: me.avatar ?? null,
  bio: me.bio ?? '',
  style: normalizeProfileStyle(me.style),
  verified: me.verified === true,
  admin: me.admin === true
})

/**
 * Where the session is kept between launches: the OS credential store
 * (DPAPI on Windows, the Keystore on Android), never a plain-text file.
 */
export interface SessionVault {
  load(): Promise<SavedSession | null>
  /** Null forgets the session. Resolves false when this device has no secure storage, so nothing was kept. */
  save(session: SavedSession | null): Promise<boolean | void>
}

export interface AccountDeps {
  store: LibraryStore
  /** For the Vanity server. */
  fetchFn: FetchFn
  /** For Neon Auth (needs to set the Cookie and Origin headers itself). */
  authHttp: AuthHttp
  backend(): BackendConfig
  vault: SessionVault
  /** The game currently running, if any (from the session tracker). */
  runningGame(): { id: number; startedAt: number } | null
  onChange(state: AccountState): void
  now?: () => number
}

/**
 * Your Vanity account. Signing in happens at Neon Auth. The Vanity server (a Neon Function)
 * holds your username, friends and shared stats, and is told what you're playing about once a
 * minute. Network trouble never signs you out: only Neon Auth saying the session is over does.
 */
export class AccountService {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private saved: SavedSession | null = null
  /** False when this sign-in should be forgotten once Vanity closes. */
  private remember = true
  /** Whether the session really is in the device's secure storage. */
  private kept = false
  private jwt: string | null = null
  private refreshing: Promise<string> | null = null
  private expired = false
  private loaded: Promise<void> | null = null

  constructor(private deps: AccountDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private auth(): NeonAuth {
    const b = this.deps.backend()
    return new NeonAuth(b.authUrl, this.deps.authHttp, b.origin)
  }

  client(): AccountClient {
    return new AccountClient(this.deps.backend().apiUrl, this.deps.fetchFn, (fresh) => this.token(fresh))
  }

  state(): AccountState {
    const b = this.deps.backend()
    return {
      available: !!b.authUrl && !!b.apiUrl,
      signedIn: !!this.saved,
      email: this.saved?.email ?? null,
      username: this.saved?.username ?? null,
      needsUsername: !!this.saved && !this.saved.username,
      sessionExpired: this.expired,
      remembered: !!this.saved && this.remember && this.kept,
      avatar: this.saved?.avatar ?? null,
      bio: this.saved?.bio ?? '',
      style: normalizeProfileStyle(this.saved?.style),
      verified: this.saved?.verified === true,
      admin: this.saved?.admin === true
    }
  }

  private emit(): void {
    this.deps.onChange(this.state())
  }

  /** Reads the saved session (once) and starts the background work. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        this.saved = await this.deps.vault.load()
        this.kept = !!this.saved
      } catch (err) {
        console.warn('[account] could not read the saved session:', err)
        this.saved = null
      }
      if (this.saved) {
        this.emit()
        this.start()
        // Picks up a username chosen on another device, and notices an ended session.
        void this.refreshProfile()
      }
    })()
    return this.loaded
  }

  // ---- signing in and out -----------------------------------------------------

  async signUp(email: string, username: string, password: string, remember: boolean): Promise<AccountState> {
    await this.load()
    email = email.trim()
    username = username.trim()
    if (!USERNAME.test(username)) throw new AccountError('Usernames are 3–20 letters, numbers or underscores.')
    if (password.length < 8) throw new AccountError('Passwords need at least 8 characters.')
    // Checked first, so a taken name doesn't leave a half-made account behind.
    if (!(await this.client().usernameAvailable(username))) throw new AccountError('That username is taken.')
    const session = await this.auth().signUp(email, password, username)
    await this.adopt(session, null, remember)
    try {
      await this.setUsername(username)
    } catch (err) {
      // The account exists; the app asks for a username again.
      console.warn('[account] could not set the username after sign-up:', err)
    }
    return this.state()
  }

  async signIn(email: string, password: string, remember: boolean): Promise<AccountState> {
    await this.load()
    const session = await this.auth().signIn(email.trim(), password)
    await this.adopt(session, null, remember)
    try {
      const me = await this.client().me()
      await this.update(profileOf(me))
    } catch (err) {
      if (!(err instanceof AccountError && err.offline)) throw err
    }
    this.start()
    return this.state()
  }

  /** Picks the username of a new account, or renames it. */
  async setUsername(username: string): Promise<AccountState> {
    username = username.trim()
    if (!USERNAME.test(username)) throw new AccountError('Usernames are 3–20 letters, numbers or underscores.')
    const me = await this.guard((c) => c.setUsername(username))
    await this.update(profileOf(me))
    this.start()
    return this.state()
  }

  /** Sets the profile picture (null removes it), the bio and/or the profile's look. */
  async setProfile(patch: { avatar?: string | null; bio?: string; style?: Partial<ProfileStyle> }): Promise<AccountState> {
    if (patch.avatar != null && !/^data:image\/(png|jpeg|webp);base64,/.test(patch.avatar)) throw new AccountError('That picture could not be used. Try a PNG or JPEG image.')
    if (patch.bio !== undefined && [...patch.bio.trim()].length > 200) throw new AccountError('Bios can be up to 200 characters.')
    const me = await this.guard((c) => c.setProfile(patch))
    await this.update(profileOf(me))
    return this.state()
  }

  async sendResetCode(email: string): Promise<void> {
    if (!email.trim()) throw new AccountError('Enter the email of your account.')
    await this.auth().sendResetCode(email.trim())
  }

  async resetPassword(email: string, code: string, password: string): Promise<void> {
    if (password.length < 8) throw new AccountError('Passwords need at least 8 characters.')
    await this.auth().resetPassword(email.trim(), code.trim(), password)
  }

  async signOut(): Promise<AccountState> {
    const cookie = this.saved?.cookie
    if (cookie) {
      await this.client().signOff().catch(() => {})
      // Ends the session on the server too. Offline: it is forgotten here and runs out by itself.
      await this.auth().signOut(cookie).catch(() => {})
    }
    await this.clearSession(false)
    return this.state()
  }

  async deleteAccount(): Promise<AccountState> {
    await this.guard((c) => c.deleteAccount())
    const cookie = this.saved?.cookie
    if (cookie) await this.auth().signOut(cookie).catch(() => {})
    await this.clearSession(false)
    return this.state()
  }

  private async adopt(session: AuthSession, username: string | null, remember: boolean): Promise<void> {
    this.remember = remember
    this.expired = false
    this.jwt = session.jwt
    this.saved = { cookie: session.cookie, userId: session.user.id, email: session.user.email, username }
    await this.persist()
    this.emit()
  }

  private async update(patch: Partial<SavedSession>): Promise<void> {
    if (!this.saved) return
    const next = { ...this.saved, ...patch }
    const changed = JSON.stringify(next) !== JSON.stringify(this.saved)
    this.saved = next
    if (!changed) return
    await this.persist()
    this.emit()
  }

  private async persist(): Promise<void> {
    try {
      this.kept = (await this.deps.vault.save(this.remember ? this.saved : null)) !== false && this.remember
    } catch (err) {
      this.kept = false
      // Still signed in for now; it just won't survive a restart.
      console.warn('[account] could not save the session:', err)
    }
  }

  private async clearSession(expired: boolean): Promise<void> {
    this.stop()
    this.saved = null
    this.jwt = null
    this.expired = expired
    await this.deps.vault.save(null).catch(() => {})
    this.emit()
  }

  // ---- tokens -----------------------------------------------------------------

  /** A token the Vanity server accepts. Asks Neon Auth for a new one when the old one is about to run out. */
  async token(fresh = false): Promise<string> {
    await this.load()
    if (!this.saved) throw new AccountError('Sign in to your Vanity account first.', true)
    if (!fresh && this.jwt && jwtExpiry(this.jwt) - TOKEN_MARGIN_MS > this.now()) return this.jwt
    this.refreshing ??= (async () => {
      const cookie = this.saved?.cookie
      if (!cookie) throw new AccountError('Sign in to your Vanity account first.', true)
      const session = await this.auth().session(cookie)
      if (!session?.jwt) {
        // Only clear the session we asked about (a new sign-in may have happened meanwhile).
        if (this.saved?.cookie === cookie) await this.clearSession(true)
        throw new AccountError('Your session has expired. Please sign in again.', true)
      }
      this.jwt = session.jwt
      if (this.saved?.cookie === cookie) await this.update({ cookie: session.cookie, email: session.user.email || this.saved.email })
      return session.jwt
    })().finally(() => (this.refreshing = null))
    return this.refreshing
  }

  private async refreshProfile(): Promise<void> {
    try {
      const me = await this.client().me()
      await this.update(profileOf(me))
    } catch {
      // Offline, or the session ended (token() has already handled that).
    }
  }

  /** Runs an account call. An ended session signs out here; other errors pass through. */
  async guard<T>(fn: (c: AccountClient) => Promise<T>): Promise<T> {
    await this.load()
    if (!this.saved) throw new AccountError('Sign in to your Vanity account first.', true)
    try {
      return await fn(this.client())
    } catch (err) {
      if (err instanceof AccountError && err.signedOut && this.saved) await this.clearSession(true)
      throw err
    }
  }

  // ---- background sync ------------------------------------------------------

  /** Friends, presence and stats need a username. */
  private get social(): boolean {
    return !!this.saved?.username
  }

  start(): void {
    this.stop()
    if (!this.social) return
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
    if (!this.social) return
    const running = this.deps.runningGame()
    const game = running ? this.deps.store.get(running.id) : null
    await this.guard((c) => c.heartbeat(game ? { gameKey: gameKey(game.name), gameName: game.name, startedAt: running!.startedAt } : null)).catch(() => {})
  }

  /** Uploads playtime for every game you've played. Never throws. */
  async syncStats(): Promise<void> {
    if (!this.social) return
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
    if (!this.social) return
    this.stop()
    await Promise.race([this.client().signOff().catch(() => {}), new Promise((r) => setTimeout(r, ms))])
  }
}
