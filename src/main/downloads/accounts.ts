import type { StoreAccounts } from '@shared/types'
import type { OwnedEntry } from '../library/owned'
import type { Gog } from './gog'
import type { Legendary } from './legendary'

const REFRESH_EVERY_MS = 6 * 60 * 60_000

export interface StoreAccountsDeps {
  legendary: Legendary
  gog: Gog
  /** Opens Epic's sign-in page in a window and resolves to the one-time code (null if closed). */
  epicLoginWindow(): Promise<string | null>
  /** Opens GOG's sign-in page in a window and resolves to the one-time code (null if closed). */
  gogLoginWindow(): Promise<string | null>
  /** The games an account owns (null: signed out). Shown in the library as "not installed". */
  onOwned(store: 'epic' | 'gog', entries: OwnedEntry[] | null): void
  onChange(state: StoreAccounts): void
}

const message = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback)

/**
 * The Epic and GOG accounts linked on this PC. Unlike the Steam link (which lives on your Vanity
 * account), these are sign-ins to the stores themselves, kept on this PC only: Epic's by
 * Legendary in its own folder, GOG's encrypted with Windows credential protection.
 */
export class StoreAccountsService {
  private s: StoreAccounts
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private deps: StoreAccountsDeps) {
    this.s = {
      supported: true,
      epic: { available: deps.legendary.available, signedIn: false, name: null, games: null, busy: false, error: null },
      gog: { signedIn: false, name: null, games: null, busy: false, error: null }
    }
  }

  state(): StoreAccounts {
    return { ...this.s, epic: { ...this.s.epic }, gog: { ...this.s.gog } }
  }

  private setEpic(patch: Partial<StoreAccounts['epic']>): void {
    this.s = { ...this.s, epic: { ...this.s.epic, ...patch } }
    this.deps.onChange(this.state())
  }

  private setGog(patch: Partial<StoreAccounts['gog']>): void {
    this.s = { ...this.s, gog: { ...this.s.gog, ...patch } }
    this.deps.onChange(this.state())
  }

  /** Reads who is signed in and refreshes their libraries, now and every few hours. Never throws. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.refresh(), REFRESH_EVERY_MS)
    void this.refresh()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async refresh(): Promise<StoreAccounts> {
    await Promise.all([this.refreshEpic(), this.refreshGog()])
    return this.state()
  }

  // ---- Epic ----

  private async refreshEpic(): Promise<void> {
    if (!this.deps.legendary.available) return
    try {
      const name = await this.deps.legendary.account()
      if (!name) {
        this.setEpic({ signedIn: false, name: null, games: null })
        this.deps.onOwned('epic', null)
        return
      }
      this.setEpic({ signedIn: true, name, error: null })
      await this.loadEpicLibrary()
    } catch (err) {
      this.setEpic({ error: message(err, "Couldn't check your Epic account.") })
    }
  }

  private async loadEpicLibrary(): Promise<void> {
    try {
      const games = await this.deps.legendary.games()
      this.setEpic({ games: games.length, error: null })
      this.deps.onOwned('epic', games.map((g) => ({ externalId: g.appName, name: g.title, coverUrl: g.coverUrl, heroUrl: g.heroUrl })))
    } catch (err) {
      // Offline, or Epic is down: keep what the library already shows.
      this.setEpic({ error: message(err, "Couldn't get your Epic library.") })
    }
  }

  /** Signs in with a code (from the sign-in window, or pasted by the user). */
  async epicLoginWithCode(code: string): Promise<StoreAccounts> {
    this.setEpic({ busy: true, error: null })
    try {
      const name = await this.deps.legendary.login(code)
      this.setEpic({ signedIn: true, name })
      await this.loadEpicLibrary()
    } finally {
      this.setEpic({ busy: false })
    }
    return this.state()
  }

  /** Opens Epic's sign-in page. Resolves when the window is closed or sign-in is done. */
  async epicLogin(): Promise<StoreAccounts> {
    const code = await this.deps.epicLoginWindow()
    if (!code) return this.state()
    return this.epicLoginWithCode(code)
  }

  async epicLogout(): Promise<StoreAccounts> {
    await this.deps.legendary.logout().catch(() => {})
    this.setEpic({ signedIn: false, name: null, games: null, error: null })
    this.deps.onOwned('epic', null)
    return this.state()
  }

  // ---- GOG ----

  private async refreshGog(): Promise<void> {
    try {
      if (!(await this.deps.gog.signedIn())) {
        this.setGog({ signedIn: false, name: null, games: null })
        this.deps.onOwned('gog', null)
        return
      }
      const name = await this.deps.gog.account()
      this.setGog({ signedIn: true, name, error: null })
      await this.loadGogLibrary()
    } catch (err) {
      if (!(await this.deps.gog.signedIn().catch(() => false))) {
        // The sign-in ran out.
        this.setGog({ signedIn: false, name: null, games: null, error: message(err, 'Sign in to GOG again.') })
        this.deps.onOwned('gog', null)
      } else this.setGog({ error: message(err, "Couldn't check your GOG account.") })
    }
  }

  private async loadGogLibrary(): Promise<void> {
    try {
      const games = await this.deps.gog.games()
      this.setGog({ games: games.length, error: null })
      this.deps.onOwned('gog', games.map((g) => ({ externalId: g.id, name: g.title, coverUrl: g.coverUrl, heroUrl: null })))
    } catch (err) {
      this.setGog({ error: message(err, "Couldn't get your GOG library.") })
    }
  }

  async gogLogin(): Promise<StoreAccounts> {
    const code = await this.deps.gogLoginWindow()
    if (!code) return this.state()
    this.setGog({ busy: true, error: null })
    try {
      await this.deps.gog.login(code)
      this.setGog({ signedIn: true, name: await this.deps.gog.account().catch(() => null) })
      await this.loadGogLibrary()
    } finally {
      this.setGog({ busy: false })
    }
    return this.state()
  }

  async gogLogout(): Promise<StoreAccounts> {
    await this.deps.gog.logout()
    this.setGog({ signedIn: false, name: null, games: null, error: null })
    this.deps.onOwned('gog', null)
    return this.state()
  }
}
