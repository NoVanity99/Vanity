import { join, parse, relative, isAbsolute, basename } from 'node:path'
import type { Game, SessionState } from '@shared/types'
import type { PlaytimeStore } from '../library/playtime'
import type { LaunchMethod } from './launch'

/** How long to wait for a game to show up after launching (Steam may update it first). */
const GRACE_MS: Record<LaunchMethod, number> = { uri: 10 * 60_000, exe: 2 * 60_000 }
/** Consecutive polls without the game before the session is over. */
const MISSES_TO_END = 2
const FAST_POLL_MS = 4_000
const SLOW_POLL_MS = 10_000

/** Folders too broad to mean "this game is running" if any process is inside them. */
const SHARED_FOLDERS = new Set([
  'program files',
  'program files (x86)',
  'games',
  'steamapps',
  'common',
  'desktop',
  'downloads',
  'documents',
  'windows',
  'users'
])

export function isTrackableFolder(folder: string): boolean {
  const { root } = parse(folder)
  const rest = folder.slice(root.length).split(/[\\/]/).filter(Boolean)
  return rest.length >= 1 && !SHARED_FOLDERS.has(basename(folder).toLowerCase())
}

function inside(child: string, parent: string): boolean {
  const rel = relative(join(parent).toLowerCase(), join(child).toLowerCase())
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** True if a running process at `processPath` belongs to the game. */
export function processBelongsTo(processPath: string, game: Pick<Game, 'installPath' | 'executablePath'>): boolean {
  if (game.executablePath && join(processPath).toLowerCase() === join(game.executablePath).toLowerCase()) return true
  return !!game.installPath && isTrackableFolder(game.installPath) && inside(processPath, game.installPath)
}

interface Session {
  game: Game
  method: LaunchMethod
  childAlive: boolean
  /** When Vanity's own child process exited, so time up to then can be credited exactly. */
  childExitedAt: number | null
  launchedAt: number
  state: 'launching' | 'running'
  sessionId: number | null
  /** Time already written to the database. */
  flushedAt: number
  misses: number
}

export interface TrackerDeps {
  store: PlaytimeStore
  listProcesses(): Promise<string[] | null>
  onChange(gameId: number, state: SessionState): void
  now?: () => number
  /** Disable the internal timer (tests call tick() themselves). */
  manual?: boolean
}

/**
 * Watches launched games and records playtime. A game counts as running while
 * Vanity's child process is alive or any process runs from its install folder.
 * Time is counted from when the game is first seen, and written every poll.
 */
export class SessionTracker {
  private sessions = new Map<number, Session>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private ticking = false
  private readonly now: () => number

  constructor(private deps: TrackerDeps) {
    this.now = deps.now ?? Date.now
  }

  /** Current state of each game being tracked. */
  states(): Record<number, Exclude<SessionState, 'stopped'>> {
    return Object.fromEntries([...this.sessions].map(([id, s]) => [id, s.state]))
  }

  /** The game that's running (the earliest, if several), and when it started. */
  running(): { id: number; startedAt: number } | null {
    for (const [id, s] of this.sessions) if (s.state === 'running') return { id, startedAt: s.launchedAt }
    return null
  }

  isTracking(gameId: number): boolean {
    return this.sessions.has(gameId)
  }

  /** Call right after a successful launch. */
  begin(game: Game, method: LaunchMethod, child?: { once(event: 'exit', cb: () => void): unknown }): void {
    const at = this.now()
    this.deps.store.recordLaunch(game.id, at)
    const existing = this.sessions.get(game.id)
    if (existing) {
      // Launched again while still tracked: keep the running session.
      if (child) this.watchChild(existing, child)
      return
    }
    const session: Session = {
      game,
      method,
      childAlive: false,
      childExitedAt: null,
      launchedAt: at,
      state: 'launching',
      sessionId: null,
      flushedAt: at,
      misses: 0
    }
    this.sessions.set(game.id, session)
    if (child) {
      // Vanity started the exe itself, so it is running right now.
      this.watchChild(session, child)
      session.state = 'running'
      session.sessionId = this.deps.store.startSession(game.id, at)
      this.deps.onChange(game.id, 'running')
    } else {
      this.deps.onChange(game.id, 'launching')
    }
    this.schedule(child ? SLOW_POLL_MS : FAST_POLL_MS)
  }

  /** One polling round. Public for tests. */
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const processes = this.sessions.size ? await this.deps.listProcesses() : []
      const now = this.now()
      for (const [gameId, s] of this.sessions) {
        // If the process list can't be read, only trust our own child process,
        // so playtime is never over-counted.
        const alive = s.childAlive || (processes ?? []).some((p) => processBelongsTo(p, s.game))
        if (alive) {
          s.misses = 0
          if (s.state === 'launching') {
            s.state = 'running'
            s.sessionId = this.deps.store.startSession(gameId, now)
            s.flushedAt = now
            this.deps.onChange(gameId, 'running')
          } else {
            this.flush(s, now)
          }
        } else if (s.state === 'running' && s.childExitedAt) {
          // Our own process exited between polls: we know exactly when, so credit up to then.
          this.flush(s, s.childExitedAt)
          s.childExitedAt = null
          if (++s.misses >= MISSES_TO_END) this.end(gameId)
        } else if (s.state === 'launching') {
          if (now - s.launchedAt > GRACE_MS[s.method]) this.end(gameId)
        } else if (++s.misses >= MISSES_TO_END) {
          this.end(gameId)
        }
      }
    } finally {
      this.ticking = false
    }
    if (this.sessions.size) {
      // Poll faster while a game is starting or looks like it just stopped.
      const unsettled = [...this.sessions.values()].some((s) => s.state === 'launching' || s.misses > 0)
      this.schedule(unsettled ? FAST_POLL_MS : SLOW_POLL_MS)
    }
  }

  /** Records time for running games up to now and stops tracking (app is quitting). */
  stopAll(): void {
    const now = this.now()
    for (const s of this.sessions.values()) if (s.state === 'running') this.flush(s, now)
    this.sessions.clear()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private watchChild(s: Session, child: { once(event: 'exit', cb: () => void): unknown }): void {
    s.childAlive = true
    child.once('exit', () => {
      s.childAlive = false
      s.childExitedAt = this.now()
      // Check soon whether anything else from the game is still running.
      this.schedule(1_000)
    })
  }

  private flush(s: Session, now: number): void {
    const seconds = Math.floor((now - s.flushedAt) / 1000)
    if (seconds <= 0 || s.sessionId === null) return
    this.deps.store.addTime(s.sessionId, s.game.id, seconds, now)
    s.flushedAt += seconds * 1000
  }

  private end(gameId: number): void {
    this.sessions.delete(gameId)
    this.deps.onChange(gameId, 'stopped')
  }

  private schedule(ms: number): void {
    if (this.deps.manual) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, ms)
  }
}
