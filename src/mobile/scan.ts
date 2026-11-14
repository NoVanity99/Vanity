import type { DetectedGame, Game, ScanSummary } from '@shared/types'
import type { InstalledApp } from '@shared/ipc'
import type { Db } from '../main/db/database'
import type { LibraryStore } from '../main/library/store'
import type { NativeApp } from './native'

const toDetected = (a: NativeApp): DetectedGame => ({ source: 'android', externalId: a.packageName, name: a.name.trim() || a.packageName, installPath: null, executablePath: null })

/** Android app icons are kept as the game's icon (and shown as its cover until real artwork is found). */
function saveIcons(db: Db, apps: NativeApp[]): void {
  const set = db.prepare("UPDATE games SET icon_path = ? WHERE source = 'android' AND external_id = ? AND (icon_path IS NULL OR icon_path LIKE 'file://%')")
  db.transaction(() => {
    for (const a of apps) if (a.icon) set.run(a.icon, a.packageName)
  })()
}

/**
 * The Android scan: every installed app that Android marks as a game is added, plus any app
 * you added yourself is kept up to date. Games that were uninstalled are flagged as missing.
 * Rescanning never creates duplicates.
 */
export function scanAndroid(db: Db, store: LibraryStore, apps: NativeApp[]): ScanSummary {
  const inLibrary = new Set(store.list().filter((g) => g.source === 'android').map((g) => g.externalId))
  const wanted = apps.filter((a) => a.isGame || inLibrary.has(a.packageName))
  const { added, updated } = store.upsert(wanted.map(toDetected))
  const missing = store.markMissing('android', apps.map((a) => a.packageName))
  saveIcons(db, wanted)
  return { progress: [], added, updated, missing, candidates: [] }
}

/** Apps that aren't in the library, for "Add a game" (some games don't tell Android they're games). */
export function appsNotInLibrary(store: LibraryStore, apps: NativeApp[]): InstalledApp[] {
  const inLibrary = new Set(store.list().filter((g) => g.source === 'android').map((g) => g.externalId))
  return apps
    .filter((a) => !inLibrary.has(a.packageName))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((a) => ({ packageName: a.packageName, name: a.name, icon: a.icon }))
}

/** Adds one installed app as a game (also if it was removed before). */
export function addApp(db: Db, store: LibraryStore, apps: NativeApp[], packageName: string): Game | null {
  const app = apps.find((a) => a.packageName === packageName)
  if (!app) return null
  const [game] = store.upsert([toDetected(app)], { restore: true }).games
  saveIcons(db, [app])
  return game ? store.get(game.id) : null
}
