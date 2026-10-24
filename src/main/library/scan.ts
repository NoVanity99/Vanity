import type { DetectedGame, GameCandidate, ScanProgress, ScanSummary, Settings } from '@shared/types'
import { scanners } from '../scanners'
import type { Scanner, ScanContext } from '../scanners/types'
import { isSameOrInside, type LibraryStore } from './store'

const SCANNER_TIMEOUT_MS = 90_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e))
    )
  })
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Drops custom-folder finds that are already in the library, that the user
 * declined before, or that live inside a launcher game's install folder.
 */
export function filterCandidates(
  candidates: GameCandidate[],
  library: Pick<DetectedGame, 'source' | 'externalId' | 'installPath' | 'executablePath'>[],
  ignoredExecutables: string[]
): GameCandidate[] {
  const ignored = new Set(ignoredExecutables.map((p) => p.toLowerCase()))
  const knownExes = new Set(library.flatMap((g) => (g.executablePath ? [g.executablePath.toLowerCase()] : [])))
  const launcherFolders = library
    .filter((g) => g.source !== 'custom' && g.source !== 'manual' && g.installPath)
    .map((g) => g.installPath!)

  return candidates.filter((c) => {
    const exe = c.executablePath!.toLowerCase()
    if (ignored.has(exe) || knownExes.has(exe)) return false
    if (library.some((g) => g.source === 'custom' && g.externalId === c.externalId)) return false
    return !launcherFolders.some((folder) => isSameOrInside(c.installPath!, folder) || isSameOrInside(folder, c.installPath!))
  })
}

export interface ScanOptions {
  settings: Settings
  store: LibraryStore
  onProgress: (progress: ScanProgress[]) => void
  scannerList?: Scanner[]
}

/**
 * Runs every enabled scanner in turn. A missing launcher is reported as
 * "skipped" and a failing scanner as "error"; neither stops the others.
 */
export async function runScan({ settings, store, onProgress, scannerList = scanners }: ScanOptions): Promise<ScanSummary> {
  const ctx: ScanContext = { customFolders: settings.customFolders }
  const active = scannerList.filter((s) => settings.enabledSources[s.source])
  const progress: ScanProgress[] = active.map((s) => ({ source: s.source, status: 'pending', found: 0 }))
  const emit = (): void => onProgress(progress.map((p) => ({ ...p })))
  let added = 0
  let updated = 0
  let candidates: GameCandidate[] = []

  emit()
  for (const [i, scanner] of active.entries()) {
    const entry = progress[i]
    entry.status = 'scanning'
    emit()
    try {
      if (!(await withTimeout(scanner.isAvailable(ctx), 15_000, scanner.source))) {
        entry.status = 'skipped'
        entry.message = scanner.source === 'custom' ? 'No folders added' : 'Launcher not found'
        continue
      }
      const found = await withTimeout(scanner.scan(ctx), SCANNER_TIMEOUT_MS, scanner.source)
      if (scanner.source === 'custom') {
        candidates = filterCandidates(found as GameCandidate[], store.list(), settings.ignoredExecutables)
        entry.found = candidates.length
        entry.message = candidates.length ? 'Waiting for you to confirm' : 'Nothing new'
      } else {
        const r = store.upsert(found)
        added += r.added
        updated += r.updated
        entry.found = found.length
      }
      entry.status = 'done'
    } catch (err) {
      console.error(`[scan] ${scanner.source} failed:`, err)
      entry.status = 'error'
      entry.message = errorMessage(err)
    } finally {
      emit()
    }
  }

  return { progress: progress.map((p) => ({ ...p })), added, updated, candidates }
}
