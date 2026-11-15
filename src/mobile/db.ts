import type { Database as SqlJsDatabase, SqlValue } from 'sql.js'
import type { Db } from '../main/db/database'
import { migrations } from '../main/db/migrations'

// On Android the library lives in SQLite compiled to WebAssembly (sql.js). This wraps it in the
// small part of better-sqlite3's API that Vanity's shared code uses (prepare/get/all/run/pluck,
// transaction, exec, pragma), so the same stores and services run on Windows and Android.

type Params = unknown[]

function bindable(args: Params): SqlValue[] | Record<string, SqlValue> | undefined {
  const value = (v: unknown): SqlValue => {
    if (v === undefined || v === null) return null
    if (typeof v === 'boolean') return v ? 1 : 0
    if (typeof v === 'bigint') return Number(v)
    return v as SqlValue
  }
  if (args.length === 0) return undefined
  const first = args[0]
  if (args.length === 1 && Array.isArray(first)) return first.map(value)
  if (args.length === 1 && first !== null && typeof first === 'object' && !(first instanceof Uint8Array)) {
    // Named parameters: better-sqlite3 takes { name } for @name, :name or $name.
    const out: Record<string, SqlValue> = {}
    for (const [k, v] of Object.entries(first as Record<string, unknown>)) {
      out[`@${k}`] = value(v)
      out[`:${k}`] = value(v)
      out[`$${k}`] = value(v)
    }
    return out
  }
  return args.map(value)
}

class Statement {
  constructor(
    private owner: MobileDatabase,
    private sql: string,
    private plucked = false
  ) {}

  pluck(): Statement {
    return new Statement(this.owner, this.sql, true)
  }

  private rows(args: Params, limit: number): unknown[] {
    const st = this.owner.raw.prepare(this.sql)
    try {
      const params = bindable(args)
      if (params) st.bind(params as never)
      const out: unknown[] = []
      while (out.length < limit && st.step()) out.push(this.plucked ? st.get()[0] : st.getAsObject())
      return out
    } finally {
      st.free()
    }
  }

  get(...args: Params): unknown {
    return this.rows(args, 1)[0]
  }

  all(...args: Params): unknown[] {
    return this.rows(args, Infinity)
  }

  run(...args: Params): { changes: number; lastInsertRowid: number } {
    const db = this.owner.raw
    const params = bindable(args)
    db.run(this.sql, params as never)
    const changes = db.getRowsModified()
    const lastInsertRowid = Number(db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0)
    this.owner.changed()
    return { changes, lastInsertRowid }
  }
}

export class MobileDatabase {
  private depth = 0
  private dirty = false

  constructor(
    public raw: SqlJsDatabase,
    /** Called (debounced by the caller) whenever data changed outside a transaction. */
    private onChange: () => void = () => {}
  ) {}

  prepare(sql: string): Statement {
    return new Statement(this, sql)
  }

  exec(sql: string): this {
    this.raw.exec(sql)
    this.changed()
    return this
  }

  pragma(text: string, opts?: { simple?: boolean }): unknown {
    const res = this.raw.exec(`PRAGMA ${text}`)
    if (/=/.test(text)) this.changed()
    const rows = res[0]?.values ?? []
    return opts?.simple ? rows[0]?.[0] : rows.map((r) => Object.fromEntries(r.map((v, i) => [res[0].columns[i], v])))
  }

  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const name = `vanity_tx_${this.depth}`
      this.raw.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`)
      this.depth++
      try {
        const result = fn(...args)
        this.depth--
        this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`)
        if (this.depth === 0 && this.dirty) this.changed()
        return result
      } catch (err) {
        this.depth--
        this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`)
        throw err
      }
    }
  }

  /** Marks the data as changed; saving waits until any transaction has finished. */
  changed(): void {
    this.dirty = true
    if (this.depth > 0) return
    this.dirty = false
    this.onChange()
  }

  /** The whole database as bytes, for saving. */
  export(): Uint8Array {
    const bytes = this.raw.export()
    // sql.js reopens the database when exporting, which forgets this setting.
    this.raw.exec('PRAGMA foreign_keys = ON')
    return bytes
  }

  close(): void {
    this.raw.close()
  }
}

/** Opens a database (from saved bytes, or new), applies migrations, and returns it typed as the shared `Db`. */
export function openMobileDatabase(SQL: { Database: new (data?: Uint8Array) => SqlJsDatabase }, saved: Uint8Array | null, onChange?: () => void): { db: Db; mobile: MobileDatabase } {
  let mobile: MobileDatabase
  try {
    mobile = new MobileDatabase(new SQL.Database(saved ?? undefined))
    mobile.raw.exec('PRAGMA foreign_keys = ON')
    migrate(mobile)
  } catch (err) {
    // An unreadable save: start fresh rather than leave the app unusable.
    console.error('[db] could not open the saved library, starting a new one:', err)
    mobile = new MobileDatabase(new SQL.Database())
    mobile.raw.exec('PRAGMA foreign_keys = ON')
    migrate(mobile)
  }
  // Only start saving once the database is open and migrated.
  ;(mobile as unknown as { onChange: () => void }).onChange = onChange ?? (() => {})
  return { db: mobile as unknown as Db, mobile }
}

function migrate(db: MobileDatabase): void {
  const current = Number(db.pragma('user_version', { simple: true }) ?? 0)
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.raw.exec(migrations[v])
      db.raw.exec(`PRAGMA user_version = ${v + 1}`)
    })()
  }
}
