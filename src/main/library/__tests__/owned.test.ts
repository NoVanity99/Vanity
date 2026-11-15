import { describe, expect, it, vi } from 'vitest'
import { dedupeByName } from '@shared/dedupe'
import type { DetectedGame, Game } from '@shared/types'
import { openDatabase } from '../../db/database'
import { createKv } from '../../db/kv'
import { createMetadataRepo } from '../../metadata/repo'
import { InstallError, Installers, SteamClientInstaller } from '../../install/installer'
import { InstallWatcher } from '../../install/watcher'
import { OwnedGames, steamOwnedEntries } from '../owned'
import { createPlaytimeStore } from '../playtime'
import { createSqliteStore } from '../store'

const steamGame = (appId: number, name: string) => ({ appId, name, playtimeMinutes: 0, playtimeTwoWeeksMinutes: 0, lastPlayedAt: null, iconUrl: null })
const installedCopy = (appId: number, name: string): DetectedGame => ({ source: 'steam', externalId: String(appId), name, installPath: `/steam/steamapps/common/${name}`, executablePath: null })

function setup() {
  const db = openDatabase(':memory:').db
  let clock = 1000
  const store = createSqliteStore(db, () => clock)
  const changes = vi.fn()
  const owned = new OwnedGames(store, createKv(db), changes)
  const byName = (name: string): Game | undefined => store.list().find((g) => g.name === name)
  return { db, store, owned, changes, byName, playtime: createPlaytimeStore(db), tick: () => (clock += 1000) }
}

const LIBRARY = [steamGame(620, 'Portal 2'), steamGame(440, 'Team Fortress 2'), steamGame(1245620, 'ELDEN RING')]

describe('games you own but haven’t installed', () => {
  it('adds owned Steam games to the library as not installed, with Steam’s own artwork', () => {
    const t = setup()
    t.store.upsert([installedCopy(620, 'Portal 2')])
    t.owned.set('steam', steamOwnedEntries(LIBRARY))

    expect(t.store.list().map((g) => [g.name, g.installed])).toEqual([
      ['ELDEN RING', false],
      ['Portal 2', true],
      ['Team Fortress 2', false]
    ])
    const elden = t.byName('ELDEN RING')!
    expect(elden).toMatchObject({ source: 'steam', externalId: '1245620', installed: false, missing: false, installPath: null, playtimeSeconds: 0 })
    expect(elden.coverPath).toMatch(/steamstatic\.com\/.*\/1245620\/library_600x900\.jpg$/)
    expect(t.changes).toHaveBeenCalledTimes(1)

    // Applying the same list again changes nothing.
    t.owned.set('steam', steamOwnedEntries(LIBRARY))
    t.owned.reapply()
    expect(t.changes).toHaveBeenCalledTimes(1)
    expect(t.store.list()).toHaveLength(3)
  })

  it('skips things in a Steam library that aren’t games', () => {
    expect(steamOwnedEntries([steamGame(1, 'Proton 9.0'), steamGame(2, 'Steam Linux Runtime 3.0'), steamGame(3, 'Steamworks Common Redistributables'), steamGame(4, 'Hades'), steamGame(5, '  ')]).map((e) => e.name)).toEqual(['Hades'])
  })

  it('moves a game to Installed when a scan finds it, and keeps it the same library entry', () => {
    const t = setup()
    t.owned.set('steam', steamOwnedEntries(LIBRARY))
    const before = t.byName('ELDEN RING')!
    t.store.update(before.id, { favorite: true })

    // Steam finished installing it: the next scan sees it.
    t.store.upsert([installedCopy(1245620, 'ELDEN RING')])
    t.store.markMissing('steam', ['1245620'])
    t.owned.reapply()

    const after = t.byName('ELDEN RING')!
    expect(after).toMatchObject({ id: before.id, installed: true, missing: false, favorite: true, installPath: '/steam/steamapps/common/ELDEN RING' })
    // The others are still simply "not installed", not "not found".
    expect(t.byName('Portal 2')).toMatchObject({ installed: false, missing: false })
  })

  it('turns an uninstalled game you still own back into "not installed", keeping its playtime', () => {
    const t = setup()
    t.store.upsert([installedCopy(620, 'Portal 2')])
    const id = t.byName('Portal 2')!.id
    const session = t.playtime.startSession(id, 0)
    t.playtime.addTime(session, id, 3600, 3_600_000)
    t.owned.set('steam', steamOwnedEntries(LIBRARY))

    // Uninstalled in Steam: the scan no longer finds it.
    expect(t.store.markMissing('steam', [])).toBe(1)
    expect(t.byName('Portal 2')).toMatchObject({ missing: true, installed: true })
    t.owned.reapply()
    expect(t.byName('Portal 2')).toMatchObject({ id, missing: false, installed: false, installPath: null, playtimeSeconds: 3600 })

    // A game that isn't installed can't go "missing" in later scans.
    expect(t.store.markMissing('steam', [])).toBe(0)
  })

  it('takes them out again when Steam is unlinked, except ones with history', () => {
    const t = setup()
    t.store.upsert([installedCopy(620, 'Portal 2')])
    t.owned.set('steam', steamOwnedEntries(LIBRARY))
    t.store.update(t.byName('Team Fortress 2')!.id, { favorite: true })

    t.owned.set('steam', null)
    expect(t.store.list().map((g) => [g.name, g.installed, g.missing])).toEqual([
      ['Portal 2', true, false], // installed games are never touched
      ['Team Fortress 2', true, true] // you favourited it: kept, shown as not found
    ])
    expect(t.changes).toHaveBeenCalledTimes(2)
    t.owned.reapply()
    expect(t.store.list()).toHaveLength(2)
  })

  it('drops a game you no longer own, and respects games you removed yourself', () => {
    const t = setup()
    t.owned.set('steam', steamOwnedEntries(LIBRARY))
    t.store.remove(t.byName('Team Fortress 2')!.id)
    // Refunded Elden Ring; removed TF2 by hand.
    t.owned.set('steam', steamOwnedEntries([LIBRARY[0], LIBRARY[1]]))
    expect(t.store.list().map((g) => g.name)).toEqual(['Portal 2'])
    // "Restore removed games" brings TF2 back on the next pass.
    t.store.restoreRemoved()
    t.owned.reapply()
    expect(t.store.list().map((g) => g.name)).toEqual(['Portal 2', 'Team Fortress 2'])
  })

  it('doesn’t fetch artwork for games that aren’t installed, until they are', () => {
    const t = setup()
    const repo = createMetadataRepo(t.db)
    t.store.upsert([installedCopy(620, 'Portal 2')])
    t.owned.set('steam', steamOwnedEntries(LIBRARY))
    expect(repo.pendingIds()).toEqual([t.byName('Portal 2')!.id])
    t.store.upsert([installedCopy(440, 'Team Fortress 2')])
    expect(repo.pendingIds().sort()).toEqual([t.byName('Portal 2')!.id, t.byName('Team Fortress 2')!.id].sort())
  })

  it('shows one entry per game: an installed copy beats one that isn’t', () => {
    const t = setup()
    t.store.upsert([{ source: 'epic', externalId: 'hades-epic', name: 'Hades', installPath: '/epic/Hades', executablePath: null }])
    t.owned.set('steam', steamOwnedEntries([steamGame(1145360, 'Hades'), steamGame(620, 'Portal 2')]))
    const shown = dedupeByName(t.store.list())
    expect(shown.map((g) => [g.name, g.source, g.installed])).toEqual([
      ['Hades', 'epic', true],
      ['Portal 2', 'steam', false]
    ])
  })
})

describe('installing', () => {
  const game = (over: Partial<Game>): Game => ({ id: 1, source: 'steam', externalId: '620', name: 'Portal 2', installed: false, missing: false, ...over }) as Game

  it('hands Steam games to the Steam client, and says so', async () => {
    const opened: string[] = []
    const installers = new Installers([new SteamClientInstaller(async (url) => void opened.push(url))])
    expect(installers.canInstall(game({}))).toBe(true)
    const started = await installers.install(game({}))
    expect(opened).toEqual(['steam://install/620'])
    expect(started.note).toMatch(/Steam games install through Steam/)
  })

  it('refuses games that are installed, or that no installer handles, with a clear message', async () => {
    const installers = new Installers([new SteamClientInstaller(async () => {})])
    await expect(installers.install(game({ installed: true }))).rejects.toThrow(/already installed/)
    await expect(installers.install(game({ source: 'gog', externalId: 'abc' }))).rejects.toThrow(/can't install Portal 2 yet/)
    expect(installers.canInstall(game({ externalId: '../evil' }))).toBe(false)
    const broken = new Installers([new SteamClientInstaller(async () => Promise.reject(new Error('no handler')))])
    await expect(broken.install(game({}))).rejects.toBeInstanceOf(InstallError)
  })

  it('lets another installer take over (a SteamCMD one later) by putting it first', async () => {
    const custom = { id: 'steamcmd', canInstall: (g: Game) => g.source === 'steam', install: async () => ({ installer: 'steamcmd', note: 'Downloading in Vanity.' }) }
    const installers = new Installers([custom, new SteamClientInstaller(async () => Promise.reject(new Error('should not be used')))])
    expect(await installers.install(game({}))).toEqual({ installer: 'steamcmd', note: 'Downloading in Vanity.' })
  })

  it('notices when the install has finished and says so once', async () => {
    const t = setup()
    t.owned.set('steam', steamOwnedEntries(LIBRARY))
    const id = t.byName('Portal 2')!.id
    let steamFinished = false
    const done: string[] = []
    let clock = 0
    const watcher = new InstallWatcher({
      rescan: async () => {
        if (steamFinished) t.store.upsert([installedCopy(620, 'Portal 2')])
        t.owned.reapply()
      },
      getGame: (gid) => t.store.get(gid),
      onInstalled: (g) => done.push(g.name),
      now: () => clock,
      manual: true
    })
    watcher.watch(id)
    await watcher.check()
    await watcher.check()
    expect(done).toEqual([])
    expect(watcher.pending()).toEqual([id])

    steamFinished = true
    await watcher.check()
    expect(done).toEqual(['Portal 2'])
    expect(watcher.pending()).toEqual([])
    await watcher.check()
    expect(done).toEqual(['Portal 2'])

    // An install that never finishes is given up on eventually; a removed game straight away.
    const tf2 = t.byName('Team Fortress 2')!.id
    watcher.watch(tf2)
    clock += 7 * 3_600_000
    await watcher.check()
    expect(watcher.pending()).toEqual([])
    watcher.watch(tf2)
    t.store.remove(tf2)
    await watcher.check()
    expect(watcher.pending()).toEqual([])
  })
})
