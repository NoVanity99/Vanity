import type { Game } from '@shared/types'

const CHECK_EVERY_MS = 30_000
/** Big games take a while; stop looking after this long (the next scan still finds it). */
const GIVE_UP_AFTER_MS = 6 * 60 * 60_000

export interface InstallWatcherDeps {
  /** Looks for installed games again (a scan of the launchers). */
  rescan(): Promise<void>
  getGame(id: number): Game | null
  /** The game is installed now. */
  onInstalled(game: Game): void
  now?: () => number
  /** Disable the internal timer (tests call check() themselves). */
  manual?: boolean
}

/**
 * After "Install" hands a game to its launcher, keeps looking until the game shows up as
 * installed, so it moves to the Installed section by itself.
 */
export class InstallWatcher {
  private waiting = new Map<number, number>()
  private timer: ReturnType<typeof setInterval> | null = null
  private checking = false

  constructor(private deps: InstallWatcherDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** Games whose install was started and hasn't been seen to finish yet. */
  pending(): number[] {
    return [...this.waiting.keys()]
  }

  watch(gameId: number): void {
    this.waiting.set(gameId, this.now())
    if (!this.timer && !this.deps.manual) this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.waiting.clear()
  }

  /** One round: rescan, then report anything that has finished. Never throws. */
  async check(): Promise<void> {
    if (this.checking || this.waiting.size === 0) return
    this.checking = true
    try {
      await this.deps.rescan().catch((err) => console.warn('[install] rescan failed:', err))
      for (const [id, since] of [...this.waiting]) {
        const game = this.deps.getGame(id)
        if (!game) this.waiting.delete(id)
        else if (game.installed && !game.missing) {
          this.waiting.delete(id)
          this.deps.onInstalled(game)
        } else if (this.now() - since > GIVE_UP_AFTER_MS) this.waiting.delete(id)
      }
    } finally {
      this.checking = false
      if (this.waiting.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }
}
