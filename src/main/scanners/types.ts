import type { DetectedGame, GameSource } from '@shared/types'

/**
 * Every launcher source implements this interface. To add a new source,
 * create a module that exports a Scanner and register it in ./index.ts.
 */
export interface Scanner {
  source: GameSource
  displayName: string
  /** Quick check for whether the launcher is present on this machine. Must not throw. */
  isAvailable(): Promise<boolean>
  /** Returns all installed games for this source. May throw; the caller isolates failures. */
  scan(): Promise<DetectedGame[]>
}
