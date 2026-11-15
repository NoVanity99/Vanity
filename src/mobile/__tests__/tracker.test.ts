import initSqlJs from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { createPlaytimeStore } from '../../main/library/playtime'
import { createSqliteStore } from '../../main/library/store'
import { openMobileDatabase } from '../db'
import { MobileTracker } from '../tracker'

let SQL: Awaited<ReturnType<typeof initSqlJs>>
beforeAll(async () => {
  SQL = await initSqlJs()
})

function setup(opts: { granted: boolean }) {
  const { db } = openMobileDatabase(SQL, null)
  const store = createSqliteStore(db)
  const [coc, mc] = store.upsert([
    { source: 'android', externalId: 'com.supercell.clashofclans', name: 'Clash of Clans', installPath: null, executablePath: null },
    { source: 'android', externalId: 'com.mojang.minecraftpe', name: 'Minecraft', installPath: null, executablePath: null }
  ]).games
  let now = 1_000_000_000
  let usage: { packageName: string; start: number; end: number }[] = []
  const launched: string[] = []
  const changes: string[] = []
  const asked: number[] = []
  const tracker = new MobileTracker({
    db,
    playtime: createPlaytimeStore(db),
    games: () => store.list(),
    launch: async (p) => void launched.push(p),
    usageAccess: async () => opts.granted,
    usage: async (since) => {
      asked.push(since)
      return usage
    },
    onChange: (id, state) => changes.push(`${id}:${state}`),
    now: () => now
  })
  return { store, tracker, coc, mc, launched, changes, asked, advance: (ms: number) => (now += ms), setUsage: (u: typeof usage) => (usage = u), now: () => now }
}

describe('playtime on Android', () => {
  it('without usage access, counts from Play until you come back', async () => {
    const t = setup({ granted: false })
    await t.tracker.launch(t.coc)
    expect(t.launched).toEqual(['com.supercell.clashofclans'])
    expect(t.tracker.states()).toEqual({ [t.coc.id]: 'running' })
    expect(t.tracker.running()?.id).toBe(t.coc.id)
    t.advance(25 * 60_000)
    await t.tracker.sync()
    expect(t.store.get(t.coc.id)).toMatchObject({ playtimeSeconds: 1500 })
    expect(t.store.get(t.coc.id)?.lastPlayedAt).toBeGreaterThan(0)
    expect(t.changes).toEqual([`${t.coc.id}:running`, `${t.coc.id}:stopped`])
    expect(t.tracker.states()).toEqual({})

    // A mis-tap (back within seconds) isn't a session; a forgotten game is capped at 6 hours.
    await t.tracker.launch(t.mc)
    t.advance(4000)
    await t.tracker.sync()
    expect(t.store.get(t.mc.id)?.playtimeSeconds).toBe(0)
    await t.tracker.launch(t.mc)
    t.advance(30 * 3_600_000)
    await t.tracker.sync()
    expect(t.store.get(t.mc.id)?.playtimeSeconds).toBe(6 * 3600)
  })

  it("with usage access, records what Android says, including games opened outside Vanity, once", async () => {
    const t = setup({ granted: true })
    await t.tracker.launch(t.coc)
    const start = t.now() + 5000
    t.advance(40 * 60_000)
    t.setUsage([
      { packageName: 'com.supercell.clashofclans', start, end: start + 600_000 },
      { packageName: 'com.mojang.minecraftpe', start: start + 700_000, end: start + 1_600_000 },
      { packageName: 'com.other.app', start, end: start + 999_000 },
      { packageName: 'com.mojang.minecraftpe', start: start + 1_700_000, end: start + 1_703_000 } // 3 s: ignored
    ])
    await t.tracker.sync()
    expect(t.store.get(t.coc.id)?.playtimeSeconds).toBe(600)
    expect(t.store.get(t.mc.id)?.playtimeSeconds).toBe(900)
    expect(t.changes).toContain(`${t.mc.id}:stopped`)

    // The next sync only asks for what came after, so nothing is counted twice.
    const first = t.asked[0]
    t.advance(60_000)
    t.setUsage([])
    await t.tracker.sync()
    expect(t.asked[1]).toBeGreaterThan(first)
    expect(t.store.get(t.coc.id)?.playtimeSeconds).toBe(600)
  })
})
