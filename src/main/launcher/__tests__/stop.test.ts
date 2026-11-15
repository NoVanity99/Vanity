import { describe, expect, it, vi } from 'vitest'
import type { Game } from '@shared/types'
import { openDatabase } from '../../db/database'
import { createPlaytimeStore } from '../../library/playtime'
import { createSqliteStore } from '../../library/store'
import { parseProcessList } from '../processes'
import { stopGame, type StopDeps } from '../stop'
import { SessionTracker } from '../tracker'

function setup(processes: { pid: number; path: string }[] | null = []) {
  const db = openDatabase(':memory:').db
  const store = createSqliteStore(db)
  let clock = 1_000_000
  const changes: [number, string][] = []
  const tracker = new SessionTracker({
    store: createPlaytimeStore(db),
    listProcesses: async () => (processes ?? []).map((p) => p.path),
    onChange: (id, state) => changes.push([id, state]),
    now: () => clock,
    manual: true
  })
  const add = (name: string, installPath: string | null, executablePath: string | null): Game =>
    store.upsert([{ source: 'custom', externalId: name, name, installPath, executablePath }]).games.find((g) => g.name === name)!
  const kill = vi.fn(async (pids: number[]) => pids.length)
  const closeWindow = vi.fn()
  const deps: StopDeps = { stopTracking: (id) => tracker.stop(id), listProcesses: async () => processes, kill, closeWindow, ownPid: 4242 }
  return { tracker, store, add, deps, kill, closeWindow, changes, advance: (ms: number) => (clock += ms) }
}

const child = (pid: number) => ({ once: () => {}, pid })

describe('stopping a game', () => {
  it('cancels a game that is still starting, without closing anything that is not the game', async () => {
    const t = setup([{ pid: 10, path: 'C:\\Program Files (x86)\\Steam\\steam.exe' }])
    const game = t.add('Portal 2', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Portal 2', null)
    t.tracker.begin(game, 'uri')
    expect(t.tracker.states()).toEqual({ [game.id]: 'launching' })

    expect(await stopGame(game.id, t.deps)).toEqual({ wasRunning: false, closed: 0 })
    expect(t.kill).not.toHaveBeenCalled()
    expect(t.tracker.states()).toEqual({})
    expect(t.changes.at(-1)).toEqual([game.id, 'stopped'])
  })

  it('closes the game’s own process and everything running from its folder, and keeps the time played', async () => {
    const t = setup([
      { pid: 100, path: '/d/Games/Hades/x64/Hades.exe' },
      { pid: 101, path: '/d/Games/Hades/x64/CrashReporter.exe' },
      { pid: 200, path: '/d/Games/Celeste/Celeste.exe' },
      { pid: 300, path: 'C:\\Windows\\explorer.exe' }
    ])
    const game = t.add('Hades', '/d/Games/Hades', '/d/Games/Hades/x64/Hades.exe')
    t.tracker.begin(game, 'exe', child(100))
    t.advance(90_000)

    expect(await stopGame(game.id, t.deps)).toEqual({ wasRunning: true, closed: 2 })
    expect([...t.kill.mock.calls[0][0]].sort()).toEqual([100, 101])
    expect(t.store.get(game.id)!.playtimeSeconds).toBe(90)
    expect(t.tracker.isTracking(game.id)).toBe(false)
  })

  it('never closes Vanity itself, or programs in a folder too broad to be one game', async () => {
    const t = setup([
      { pid: 4242, path: '/c/Games/Tool.exe' },
      { pid: 50, path: '/c/Games/Other Game/other.exe' },
      { pid: 51, path: '/c/Games/Tool.exe' }
    ])
    // A loose exe in a shared "Games" folder: only that exact program is the game.
    const game = t.add('Tool', '/c/Games', '/c/Games/Tool.exe')
    t.tracker.begin(game, 'exe', child(51))
    await stopGame(game.id, t.deps)
    expect(t.kill.mock.calls[0][0]).toEqual([51])
  })

  it('closes a web game by closing its window', async () => {
    const t = setup()
    const game = t.add('Web Game', '/d/Games/web', '/d/Games/web/index.html')
    t.tracker.begin(game, 'html', { once: () => {} })
    expect(await stopGame(game.id, t.deps)).toEqual({ wasRunning: true, closed: 1 })
    expect(t.closeWindow).toHaveBeenCalledWith(game.id)
    expect(t.kill).not.toHaveBeenCalled()
  })

  it('still closes the process Vanity started when the process list can’t be read', async () => {
    const t = setup(null)
    const game = t.add('Hades', '/d/Games/Hades', '/d/Games/Hades/Hades.exe')
    t.tracker.begin(game, 'exe', child(77))
    expect(await stopGame(game.id, t.deps)).toEqual({ wasRunning: true, closed: 1 })
    expect(t.kill.mock.calls[0][0]).toEqual([77])
  })

  it('does nothing for a game that is not running', async () => {
    const t = setup([{ pid: 1, path: '/d/Games/Hades/Hades.exe' }])
    const game = t.add('Hades', '/d/Games/Hades', '/d/Games/Hades/Hades.exe')
    expect(await stopGame(game.id, t.deps)).toEqual({ wasRunning: false, closed: 0 })
    expect(t.kill).not.toHaveBeenCalled()
  })

  it('reads the process list Windows prints', () => {
    expect(parseProcessList('\uFEFF1234\tC:\\Games\\A B\\game.exe\r\n88\tD:\\x.exe\r\n\r\nbad line\r\n0\tC:\\zero.exe\r\n')).toEqual([
      { pid: 1234, path: 'C:\\Games\\A B\\game.exe' },
      { pid: 88, path: 'D:\\x.exe' }
    ])
  })
})
