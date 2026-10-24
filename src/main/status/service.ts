import type { LauncherStatus, StoreLauncher } from '@shared/types'
import type { FetchFn } from '../metadata/http'
import { STATUS_CHECKS, type CheckResult } from './checks'

export const STATUS_INTERVAL_MS = 5 * 60_000

export interface StatusDeps {
  fetchFn: FetchFn
  onUpdate(statuses: LauncherStatus[]): void
  checks?: Partial<Record<StoreLauncher, (fetchFn: FetchFn) => Promise<CheckResult>>>
  now?: () => number
}

/** Checks whether each launcher's services are reachable, every few minutes. */
export class StatusService {
  private statuses: LauncherStatus[]
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<void> | null = null
  private readonly checks: Partial<Record<StoreLauncher, (fetchFn: FetchFn) => Promise<CheckResult>>>
  private readonly now: () => number

  constructor(private deps: StatusDeps) {
    this.checks = deps.checks ?? STATUS_CHECKS
    this.now = deps.now ?? Date.now
    this.statuses = (Object.keys(this.checks) as StoreLauncher[]).map((launcher) => ({ launcher, state: 'unknown', detail: null, checkedAt: null }))
  }

  get(): LauncherStatus[] {
    return this.statuses
  }

  /** Runs all checks in parallel. A check that throws counts as offline; it never rejects. */
  check(): Promise<void> {
    this.running ??= (async () => {
      try {
        const results = await Promise.all(
          this.statuses.map(async ({ launcher }) => {
            let r: CheckResult
            try {
              r = await this.checks[launcher]!(this.deps.fetchFn)
            } catch {
              r = { online: false, detail: "Couldn't connect" }
            }
            return { launcher, state: r.online ? 'online' : 'offline', detail: r.detail, checkedAt: this.now() } as LauncherStatus
          })
        )
        this.statuses = results
        this.deps.onUpdate(results)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  start(): void {
    if (this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), STATUS_INTERVAL_MS)
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
