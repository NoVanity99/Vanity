import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../database'
import { migrations } from '../migrations'

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'vanity-db-')), 'vanity.db')

describe('openDatabase', () => {
  it('creates the schema and persists data across reopen', () => {
    const file = tempFile()
    const first = openDatabase(file)
    expect(first.warning).toBeUndefined()
    expect(first.db.pragma('user_version', { simple: true })).toBe(migrations.length)
    first.db
      .prepare("INSERT INTO games (source, external_id, name, added_at, last_seen_at) VALUES ('steam', '1', 'X', 0, 0)")
      .run()
    first.db.close()

    const second = openDatabase(file)
    expect(second.db.prepare('SELECT name FROM games').pluck().get()).toBe('X')
    second.db.close()
  })

  it('moves a corrupt file aside and starts fresh instead of crashing', () => {
    const file = tempFile()
    writeFileSync(file, 'this is not a sqlite database'.repeat(200))
    const { db, warning } = openDatabase(file)
    expect(warning).toMatch(/new one was created/)
    expect(db.prepare('SELECT COUNT(*) FROM games').pluck().get()).toBe(0)
    expect(readdirSync(join(file, '..')).some((f) => f.includes('.corrupt-'))).toBe(true)
    db.close()
  })

  it('falls back to memory when the folder is unusable', () => {
    const { db, warning } = openDatabase(join(tempFile(), 'not-a-dir', 'vanity.db'))
    expect(warning).toMatch(/will not be saved/)
    expect(existsSync(db.name)).toBe(false)
    db.close()
  })
})
