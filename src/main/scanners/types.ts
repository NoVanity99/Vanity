import type { DetectedGame, ScanSource } from '@shared/types'

export interface ScanContext {
  customFolders: string[]
}

/**
 * Every launcher source implements this interface. To add a new source,
 * create a module that exports a Scanner and register it in ./index.ts.
 */
export interface Scanner {
  source: ScanSource
  /** Quick check for whether the launcher is present on this machine. Must not throw. */
  isAvailable(ctx: ScanContext): Promise<boolean>
  /** Returns all installed games for this source. May throw; the caller isolates failures. */
  scan(ctx: ScanContext): Promise<DetectedGame[]>
}
