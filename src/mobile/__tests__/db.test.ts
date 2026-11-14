import initSqlJs from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { migrations } from '../../main/db/migrations'
import { createCollectionsStore } from '../../main/library/collections'
import { createPlaytimeStore } from '../../main/library/playtime'
import { gamePlayStats, playStats } from '../../main/library/stats'
import { createSqliteStore } from '../../main/library/store'
import { createMetadataRepo } from '../../main/metadata/repo'
import { openMobileDatabase } from '../db'

let SQL: Awaited<ReturnType<typeof initSqlJs>>
beforeAll(async () => {
  SQL = await initSqlJs()
})

describe('the Android database runs the same library code as Windows', () => {
  it('migrates, stores games, collections, playtime and stats', () => {
    let saves = 0
    const { db, mobile } = openMobileDatabase(SQL, null, () => saves++)
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length)

    const store = createSqliteStore(db, () => 1000)
    const before = saves
    const { added, games } = store.upsert([
      { source: 'android', externalId: 'com.supercell.clashofclans', name: 'Clash of Clans', installPath: null, executablePath: null },
      { source: 'android', externalId: 'com.mojang.minecraftpe', name: 'Minecraft', installPath: null, executablePath: null }
    ])
    expect(added).toBe(2)
    expect(saves).toBe(before + 1) // one save for the whole transaction
    const [coc, mc] = games
    expect(coc).toMatchObject({ source: 'android', name: 'Clash of Clans', favorite: false, genres: [], collections: [], playStatus: null })

    // Rescan: no duplicates; missing games are flagged.
    expect(store.upsert([{ source: 'android', externalId: 'com.mojang.minecraftpe', name: 'Minecraft', installPath: null, executablePath: null }]).added).toBe(0)
    expect(store.markMissing('android', ['com.mojang.minecraftpe'])).toBe(1)
    expect(store.get(coc.id)?.missing).toBe(true)

    expect(store.update(mc.id, { favorite: true, playStatus: 'playing', userRating: 5, genres: ['Sandbox'] })).toMatchObject({ favorite: true, playStatus: 'playing', userRating: 5, genres: ['Sandbox'] })

    const cols = createCollectionsStore(db, () => 5)
    const c = cols.create('Phone favourites')
    cols.setMember(c.id, mc.id, true)
    expect(store.get(mc.id)?.collections).toEqual([c.id])
    expect(() => cols.create('phone favourites')).toThrow(/already/)

    const pt = createPlaytimeStore(db)
    const s = pt.startSession(mc.id, 10_000)
    pt.addTime(s, mc.id, 1800, 1_810_000)
    pt.recordLaunch(mc.id, 10_000)
    expect(store.get(mc.id)).toMatchObject({ playtimeSeconds: 1800, lastPlayedAt: 10_000 })
    expect(playStats(db, 2_000_000)).toMatchObject({ totalSeconds: 1800, gamesPlayed: 1, sessions: 1, firstPlayed: { [mc.id]: 10_000 } })
    expect(gamePlayStats(db, mc.id)).toMatchObject({ sessions: 1, averageSeconds: 1800, rank: 1 })

    const repo = createMetadataRepo(db)
    expect(typeof repo).toBe('object')

    // Deleting a game removes its sessions and collection entries (foreign keys stay on after a save).
    const bytes = mobile.export()
    store.remove(mc.id)
    expect(db.prepare('SELECT COUNT(*) FROM play_sessions').pluck().get()).toBe(0)
    expect(db.prepare('SELECT COUNT(*) FROM collection_games').pluck().get()).toBe(0)

    // What was saved can be opened again.
    const reopened = openMobileDatabase(SQL, bytes)
    expect(createSqliteStore(reopened.db).list().map((g) => g.name)).toEqual(['Clash of Clans', 'Minecraft'])
  })

  it('rolls back failed transactions and supports the kv cache', () => {
    const { db } = openMobileDatabase(SQL, null)
    const put = db.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    put.run('a', '1', 1)
    put.run('a', '2', 2)
    expect(db.prepare('SELECT value, updated_at FROM kv WHERE key = ?').get('a')).toEqual({ value: '2', updated_at: 2 })
    expect(db.prepare('SELECT value FROM kv WHERE key = ?').pluck().get('missing')).toBeUndefined()
    expect(() =>
      db.transaction(() => {
        put.run('b', 'x', 1)
        throw new Error('boom')
      })()
    ).toThrow('boom')
    expect(db.prepare('SELECT COUNT(*) FROM kv').pluck().get()).toBe(1)
  })

  it('starts fresh if the saved file is unreadable', () => {
    const { db } = openMobileDatabase(SQL, new Uint8Array([1, 2, 3, 4]))
    expect(createSqliteStore(db).list()).toEqual([])
  })
})
