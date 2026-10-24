import { copyFileSync, existsSync, renameSync } from 'node:fs'
import Database from 'better-sqlite3'
import { migrations } from './migrations'

export type Db = Database.Database

/** Applies pending migrations, each in its own transaction. */
export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

function openAndMigrate(file: string): Db {
  const db = new Database(file)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 3000')
    if (file !== ':memory:') {
      const result = db.pragma('quick_check', { simple: true })
      if (result !== 'ok') throw new Error(`database failed integrity check: ${result}`)
    }
    const version = db.pragma('user_version', { simple: true }) as number
    if (file !== ':memory:' && version > 0 && version < migrations.length) {
      // Keep a copy from before the upgrade, in case a migration goes wrong.
      db.pragma('wal_checkpoint(TRUNCATE)')
      copyFileSync(file, `${file}.v${version}.bak`)
    }
    migrate(db)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

export interface OpenResult {
  db: Db
  /** Set when the database could not be used normally; the UI should tell the user. */
  warning?: string
}

/**
 * Opens (creating if needed) the library database. A corrupt file is moved
 * aside and replaced with a fresh one; if even that fails, an in-memory
 * database keeps the app usable for this session.
 */
export function openDatabase(file: string): OpenResult {
  try {
    return { db: openAndMigrate(file) }
  } catch (err) {
    console.error('[db] failed to open', file, err)
  }

  if (existsSync(file)) {
    const aside = `${file}.corrupt-${Date.now()}`
    try {
      renameSync(file, aside)
      for (const ext of ['-wal', '-shm']) if (existsSync(file + ext)) renameSync(file + ext, aside + ext)
      return {
        db: openAndMigrate(file),
        warning: `Your library database could not be read, so a new one was created. The old file was kept as ${aside}.`
      }
    } catch (err) {
      console.error('[db] could not recreate database', err)
    }
  }

  return {
    db: openAndMigrate(':memory:'),
    warning: 'The library database could not be opened. Changes made this session will not be saved.'
  }
}
