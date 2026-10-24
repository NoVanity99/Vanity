import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { DetectedGame, Game } from '@shared/types'
import { openDatabase } from '../../db/database'
import { createPlaytimeStore } from '../../library/playtime'
import { createSqliteStore } from '../../library/store'
import { isTrackableFolder, processBelongsTo, SessionTracker } from '../tracker'

const steamGame: DetectedGame = {
  source: 'steam',
  externalId: '620',
  name: 'Portal 2',
  installPath: '/steam/steamapps/common/Portal 2',
  executablePath: null
}

function setup(game: DetectedGame = steamGame) {
  const db = openDatabase(':memory:').db
  const library = createSqliteStore(db)
  const [stored] = library.upsert([game]).games
  let now = 1_000_000
  let processes: string[] | null = []
  const changes: string[] = []
  const tracker = new SessionTracker({
    store: createPlaytimeStore(db),
    listProcesses: async () => processes,
    onChange: (_id, state) => changes.push(state),
    now: () => now,
    manual: true
  })
  return {
    db,
    stored,
    tracker,
    changes,
    get: () => library.get(stored.id) as Game,
    advance: (seconds: number) => (now += seconds * 1000),
    setProcesses: (p: string[] | null) => (processes = p),
    sessions: () => db.prepare('SELECT started_at, ended_at, duration_seconds FROM play_sessions').all()
  }
}

describe('processBelongsTo', () => {
  it('matches processes inside the install folder, case-insensitively', () => {
    const g = { installPath: '/steam/common/Portal 2', executablePath: null }
    expect(processBelongsTo('/Steam/Common/Portal 2/bin/portal2.exe', g)).toBe(true)
    expect(processBelongsTo('/steam/common/Portal 2 Mods/x.exe', g)).toBe(false)
    expect(processBelongsTo('/steam/steam.exe', g)).toBe(false)
  })

  it('does not treat broad folders as a game folder', () => {
    expect(isTrackableFolder('/')).toBe(false)
    expect(isTrackableFolder('/home/me/Downloads')).toBe(false)
    expect(isTrackableFolder('/games/Celeste')).toBe(true)
    const g = { installPath: '/home/me/Downloads', executablePath: '/home/me/Downloads/game.exe' }
    expect(processBelongsTo('/home/me/Downloads/other.exe', g)).toBe(false)
    expect(processBelongsTo('/home/me/Downloads/game.exe', g)).toBe(true)
  })
})

describe('SessionTracker', () => {
  it('counts time from when the game appears until it exits', async () => {
    const t = setup()
    t.tracker.begin(t.stored, 'uri')
    expect(t.get().lastPlayedAt).toBe(1_000_000)
    expect(t.changes).toEqual(['launching'])

    // Steam spends 30 s updating before the game starts: not counted.
    t.advance(30)
    await t.tracker.tick()
    expect(t.tracker.states()).toEqual({ [t.stored.id]: 'launching' })

    t.setProcesses(['/steam/steamapps/common/Portal 2/portal2.exe'])
    t.advance(4)
    await t.tracker.tick()
    expect(t.changes).toEqual(['launching', 'running'])

    for (let i = 0; i < 6; i++) {
      t.advance(10)
      await t.tracker.tick()
    }
    expect(t.get().playtimeSeconds).toBe(60) // written while running, not only at the end

    t.setProcesses([])
    t.advance(10)
    await t.tracker.tick()
    t.advance(10)
    await t.tracker.tick()
    expect(t.changes).toEqual(['launching', 'running', 'stopped'])
    expect(t.tracker.isTracking(t.stored.id)).toBe(false)
    expect(t.get().playtimeSeconds).toBe(60)
    expect(t.sessions()).toEqual([{ started_at: 1_034_000, ended_at: 1_094_000, duration_seconds: 60 }])
  })

  it('gives up if the game never starts', async () => {
    const t = setup()
    t.tracker.begin(t.stored, 'uri')
    t.advance(11 * 60)
    await t.tracker.tick()
    expect(t.changes).toEqual(['launching', 'stopped'])
    expect(t.sessions()).toEqual([])
    expect(t.get().playtimeSeconds).toBe(0)
    expect(t.get().lastPlayedAt).toBe(1_000_000) // still counts as last played
  })

  it('tracks a directly launched exe through its child process', async () => {
    const t = setup({ ...steamGame, source: 'custom', installPath: '/games/Celeste', executablePath: '/games/Celeste/Celeste.exe' })
    const child = new EventEmitter()
    t.setProcesses(null) // process list unavailable
    t.tracker.begin(t.stored, 'exe', child)
    expect(t.changes).toEqual(['running']) // known to be running from the moment it is spawned
    await t.tracker.tick()
    t.advance(25)
    await t.tracker.tick()
    expect(t.get().playtimeSeconds).toBe(25)
    t.advance(6)
    child.emit('exit') // exits 6 s after the last poll
    t.advance(4)
    await t.tracker.tick()
    t.advance(10)
    await t.tracker.tick()
    expect(t.changes.at(-1)).toBe('stopped')
    expect(t.get().playtimeSeconds).toBe(31)
  })

  it('keeps tracking after a launcher stub exits and the real game takes over', async () => {
    const t = setup({ ...steamGame, source: 'custom', installPath: '/games/Stray', executablePath: '/games/Stray/Stray.exe' })
    const stub = new EventEmitter()
    t.tracker.begin(t.stored, 'exe', stub)
    await t.tracker.tick()
    stub.emit('exit')
    t.setProcesses(['/games/Stray/Hk_project/Binaries/Win64/Stray-Win64-Shipping.exe'])
    t.advance(10)
    await t.tracker.tick()
    t.advance(10)
    await t.tracker.tick()
    expect(t.tracker.states()).toEqual({ [t.stored.id]: 'running' })
    expect(t.get().playtimeSeconds).toBe(20)
  })

  it('does not start a second session when launched again', async () => {
    const t = setup()
    t.setProcesses(['/steam/steamapps/common/Portal 2/portal2.exe'])
    t.tracker.begin(t.stored, 'uri')
    await t.tracker.tick()
    t.tracker.begin(t.stored, 'uri')
    t.advance(10)
    await t.tracker.tick()
    expect(t.sessions()).toHaveLength(1)
  })

  it('records time up to quitting', async () => {
    const t = setup()
    t.setProcesses(['/steam/steamapps/common/Portal 2/portal2.exe'])
    t.tracker.begin(t.stored, 'uri')
    await t.tracker.tick()
    t.advance(7)
    t.tracker.stopAll()
    expect(t.get().playtimeSeconds).toBe(7)
  })
})
