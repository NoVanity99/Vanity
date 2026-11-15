// Two "devices" (each with its own database) syncing through the real Vanity server code.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settingsDefaults'
import type { DetectedGame, Settings } from '@shared/types'
import { AccountClient } from '../../account/client'
import { AccountError } from '../../account/errors'
import type { AccountService } from '../../account/service'
import { openDatabase, type Db } from '../../db/database'
import { createCollectionsStore } from '../../library/collections'
import { createPlaytimeStore } from '../../library/playtime'
import { createSqliteStore } from '../../library/store'
import { SyncService } from '../service'
import { tracked } from '../track'

// The server (and its in-process Postgres) lives in server/ with its own dependencies.
const BACKEND_MODULE = join(__dirname, '../../../../server/test/support/backend.ts')
const serverReady = existsSync(join(__dirname, '../../../../server/node_modules/@electric-sql/pglite'))

type Backend = { fetchFn: (url: string, init?: RequestInit) => Promise<Response>; setDown(down: boolean): void; requests(): number }
let backend: Backend
let clock = Date.UTC(2026, 10, 14, 12)
const now = (): number => clock
const DAY = 86_400_000

const detected = (name: string, source: DetectedGame['source'] = 'steam'): DetectedGame => ({ source, externalId: `${source}-${name}`, name, installPath: null, executablePath: null })

/** A Vanity installation: its own database and settings, signed in (or not) as `user`. */
function device(name: string, user: string | null = 'alice') {
  const db: Db = openDatabase(':memory:').db
  const store = createSqliteStore(db, now)
  const playtime = createPlaytimeStore(db)
  let settings: Settings = { ...DEFAULT_SETTINGS }
  let signedIn = user
  let applied = 0
  const account = {
    state: () => ({ available: true, signedIn: !!signedIn, email: signedIn ? `${signedIn}@example.com` : null, username: signedIn, needsUsername: false, sessionExpired: false, remembered: true }),
    load: async () => {},
    guard: async <T,>(fn: (c: AccountClient) => Promise<T>): Promise<T> => {
      if (!signedIn) throw new AccountError('Sign in first.', true)
      return fn(new AccountClient('http://vanity.test', backend.fetchFn, async () => `t:${signedIn}`))
    }
  } as unknown as AccountService
  const sync = new SyncService({
    db,
    account,
    getSettings: () => settings,
    applySettings: async (patch) => {
      settings = { ...settings, ...patch }
      applied++
    },
    deviceName: name,
    onChange: () => {},
    now,
    newId: () => `device-${name}-0001`
  })
  const collections = tracked(createCollectionsStore(db, now), ['list'], () => sync.collectionsChanged())
  const add = (title: string, source?: DetectedGame['source']): number => store.upsert([detected(title, source)]).games.find((g) => g.name === title && (!source || g.source === source))!.id
  /** Records a play session of `seconds`, ending now. */
  const play = (id: number, seconds: number): void => {
    playtime.recordLaunch(id, clock - seconds * 1000)
    const session = playtime.startSession(id, clock - seconds * 1000)
    playtime.addTime(session, id, seconds, clock)
  }
  return {
    db,
    store,
    sync,
    collections,
    add,
    play,
    settings: () => settings,
    saveSettings: (patch: Partial<Settings>) => {
      const before = settings
      settings = { ...settings, ...patch }
      sync.settingsChanged(before, settings)
    },
    appliedSettings: () => applied,
    signIn: (u: string | null) => (signedIn = u),
    game: (id: number) => store.get(id)!
  }
}

beforeEach(async () => {
  clock = Date.UTC(2026, 10, 14, 12)
  if (!serverReady) return
  // Loaded by path at run time, so the app's type-check doesn't pull in the server project.
  const { testBackend } = (await import(/* @vite-ignore */ BACKEND_MODULE)) as { testBackend(): Promise<Backend> }
  backend = await testBackend()
  for (const u of ['alice', 'bob']) {
    await backend.fetchFn('http://vanity.test/me/username', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer t:${u}` }, body: JSON.stringify({ username: u }) })
  }
})

describe.skipIf(!serverReady)('cloud sync between two devices', () => {
  it('adds playtime and launches from both devices, without double counting', async () => {
    const pc = device('pc')
    const phone = device('phone')
    const pcPortal = pc.add('Portal 2')
    const phonePortal = phone.add('Portal 2', 'android')
    pc.play(pcPortal, 3600)
    pc.play(pcPortal, 1800)
    phone.play(phonePortal, 600)

    await pc.sync.syncNow()
    await phone.sync.syncNow()
    await pc.sync.syncNow()

    expect(pc.game(pcPortal).playtimeSeconds).toBe(6000)
    expect(phone.game(phonePortal).playtimeSeconds).toBe(6000)
    for (const d of [pc, phone]) {
      const p = d.sync.progress()
      expect(p.totals).toMatchObject({ playtimeSeconds: 6000, launches: 3, gamesPlayed: 1 })
      expect(p.sync.status).toBe('synced')
    }
    // Syncing again changes nothing (no feedback loop of the phone's time back into the PC's).
    await pc.sync.syncNow()
    await phone.sync.syncNow()
    await pc.sync.syncNow()
    expect(pc.game(pcPortal).playtimeSeconds).toBe(6000)
    expect(phone.sync.progress().totals.playtimeSeconds).toBe(6000)

    // More play on the phone reaches the PC.
    clock += 3_600_000
    phone.play(phonePortal, 300)
    await phone.sync.syncNow()
    await pc.sync.syncNow()
    expect(pc.game(pcPortal).playtimeSeconds).toBe(6300)
    expect(pc.game(pcPortal).lastPlayedAt).toBe(phone.game(phonePortal).lastPlayedAt)
  })

  it('counts a game you only have on another device in your totals and profile', async () => {
    const pc = device('pc')
    const phone = device('phone')
    pc.play(pc.add('Elden Ring'), 7200)
    phone.play(phone.add('Alto', 'android'), 900)
    await pc.sync.syncNow()
    await phone.sync.syncNow()

    const p = phone.sync.progress()
    expect(p.totals).toMatchObject({ playtimeSeconds: 8100, gamesPlayed: 2 })
    expect(p.topGames.map((g) => [g.name, g.gameId === null])).toEqual([
      ['Elden Ring', true],
      ['Alto', false]
    ])
    // Installing it later picks its time up from the cloud.
    const id = phone.add('ELDEN RING™', 'android')
    await phone.sync.syncNow()
    expect(phone.game(id).playtimeSeconds).toBe(7200)
    expect(phone.sync.progress().totals).toMatchObject({ playtimeSeconds: 8100, gamesPlayed: 2 })
  })

  it('treats two copies of the same game on one device as one game', async () => {
    const pc = device('pc')
    const phone = device('phone')
    const steam = pc.add('Hades', 'steam')
    const epic = pc.add('Hades', 'epic')
    pc.play(steam, 1000)
    pc.play(epic, 500)
    phone.play(phone.add('Hades', 'android'), 200)
    await pc.sync.syncNow()
    await phone.sync.syncNow()
    await pc.sync.syncNow()
    expect(pc.sync.progress().totals).toMatchObject({ playtimeSeconds: 1700, gamesPlayed: 1 })
    expect(pc.game(steam).playtimeSeconds + pc.game(epic).playtimeSeconds).toBe(1700)
    expect(phone.sync.progress().totals.playtimeSeconds).toBe(1700)
  })

  it('syncs favourites, status, rating and notes: the newest change wins', async () => {
    const pc = device('pc')
    const phone = device('phone')
    const a = pc.add('Celeste')
    const b = phone.add('Celeste', 'android')

    pc.store.update(a, { favorite: true, playStatus: 'playing', userRating: 5, notes: 'B-sides!' })
    await pc.sync.syncNow()
    await phone.sync.syncNow()
    expect(phone.game(b)).toMatchObject({ favorite: true, playStatus: 'playing', userRating: 5, notes: 'B-sides!' })

    // Both change it while apart: the later change wins on both.
    clock += 60_000
    pc.store.update(a, { playStatus: 'beaten' })
    clock += 60_000
    phone.store.update(b, { playStatus: 'completed', favorite: false })
    await pc.sync.syncNow()
    await phone.sync.syncNow()
    await pc.sync.syncNow()
    expect(pc.game(a)).toMatchObject({ playStatus: 'completed', favorite: false, userRating: 5 })
    expect(phone.game(b)).toMatchObject({ playStatus: 'completed', favorite: false })

    // An older change that arrives late doesn't undo a newer one.
    const late = device('laptop')
    const c = late.add('Celeste')
    clock -= 3_600_000
    late.store.update(c, { playStatus: 'dropped' })
    clock += 3_600_000
    await late.sync.syncNow()
    expect(late.game(c).playStatus).toBe('completed')
    await pc.sync.syncNow()
    expect(pc.game(a).playStatus).toBe('completed')
  })

  it('syncs collections as a whole, keeping games the other device doesn’t have', async () => {
    const pc = device('pc')
    const phone = device('phone')
    const portal = pc.add('Portal 2')
    const itTakesTwo = pc.add('It Takes Two')
    const phonePortal = phone.add('Portal 2', 'android')

    const coop = pc.collections.create('Co-op')
    pc.collections.setMember(coop.id, portal, true)
    pc.collections.setMember(coop.id, itTakesTwo, true)
    await pc.sync.syncNow()
    await phone.sync.syncNow()

    expect(phone.collections.list().map((c) => c.name)).toEqual(['Co-op'])
    expect(phone.game(phonePortal).collections).toHaveLength(1)

    // The phone renames it and adds a collection; It Takes Two (not on the phone) must survive the round trip.
    clock += 60_000
    phone.collections.rename(phone.collections.list()[0].id, 'Couch co-op')
    phone.collections.create('Mobile')
    await phone.sync.syncNow()
    await pc.sync.syncNow()
    expect(pc.collections.list().map((c) => c.name)).toEqual(['Couch co-op', 'Mobile'])
    expect(pc.game(itTakesTwo).collections).toHaveLength(1)
    expect(pc.game(portal).collections).toHaveLength(1)

    // Deleting on one device deletes on the other.
    clock += 60_000
    pc.collections.remove(pc.collections.list().find((c) => c.name === 'Mobile')!.id)
    await pc.sync.syncNow()
    await phone.sync.syncNow()
    expect(phone.collections.list().map((c) => c.name)).toEqual(['Couch co-op'])
  })

  it('syncs look-and-feel settings, never folders', async () => {
    const pc = device('pc')
    const phone = device('phone')
    pc.saveSettings({ theme: 'ocean', font: 'retro', customFolders: ['D:\\Games'], musicFolder: 'D:\\Music' })
    await pc.sync.syncNow()
    await phone.sync.syncNow()
    expect(phone.settings()).toMatchObject({ theme: 'ocean', font: 'retro', customFolders: [], musicFolder: null })
    expect(phone.appliedSettings()).toBe(1)

    // A setting that isn't synced doesn't count as a change.
    clock += 60_000
    phone.saveSettings({ musicVolume: 0.2 })
    clock += 60_000
    pc.saveSettings({ theme: 'royal' })
    await phone.sync.syncNow()
    await pc.sync.syncNow()
    await phone.sync.syncNow()
    expect(phone.settings().theme).toBe('royal')
    expect(pc.settings().theme).toBe('royal')
    // A device that never touched its settings keeps receiving, and applies nothing twice.
    await phone.sync.syncNow()
    expect(phone.appliedSettings()).toBe(2)
  })

  it('merges days played into one streak, and badges into one set', async () => {
    const pc = device('pc')
    const phone = device('phone')
    const a = pc.add('Hades')
    const b = phone.add('Hades', 'android')
    // PC on days 1 and 3, phone on day 2: together a 3-day streak.
    clock -= 2 * DAY
    pc.play(a, 600)
    clock += DAY
    phone.play(b, 600)
    clock += DAY
    pc.play(a, 600)

    expect(pc.sync.progress().totals.bestStreak).toBe(1)
    await pc.sync.syncNow()
    await phone.sync.syncNow()
    await pc.sync.syncNow()
    for (const d of [pc, phone]) {
      const p = d.sync.progress()
      expect(p.totals).toMatchObject({ daysPlayed: 3, currentStreak: 3, bestStreak: 3 })
      expect(p.badges.find((x) => x.id === 'streak-3')?.unlockedAt).toBeTruthy()
      expect(p.badges.find((x) => x.id === 'first-launch')?.unlockedAt).toBeTruthy()
      expect(p.badges.find((x) => x.id === 'streak-7')).toMatchObject({ unlockedAt: null, current: 3, target: 7 })
    }
    expect(pc.sync.progress().xp).toBe(phone.sync.progress().xp)
    // Both devices agree on when each badge was unlocked (the earliest).
    const times = (d: typeof pc): (number | null)[] => d.sync.progress().badges.map((x) => x.unlockedAt)
    await phone.sync.syncNow()
    expect(times(pc)).toEqual(times(phone))
  })

  it('works offline and catches up afterwards', async () => {
    const pc = device('pc')
    const phone = device('phone')
    const a = pc.add('Hades')
    const b = phone.add('Hades', 'android')
    pc.play(a, 600)
    await pc.sync.syncNow()

    backend.setDown(true)
    pc.play(a, 1200)
    pc.store.update(a, { favorite: true })
    await pc.sync.syncNow()
    const offline = pc.sync.progress()
    expect(offline.sync.status).toBe('offline')
    expect(offline.sync.message).toMatch(/saved on this device/)
    // Everything still counts locally.
    expect(offline.totals.playtimeSeconds).toBe(1800)
    expect(pc.game(a).favorite).toBe(true)
    pc.sync.stop()

    backend.setDown(false)
    await pc.sync.syncNow()
    expect(pc.sync.progress().sync.status).toBe('synced')
    await phone.sync.syncNow()
    expect(phone.game(b)).toMatchObject({ playtimeSeconds: 1800, favorite: true })
  })

  it('keeps progress on the device when signed out, and uploads it after signing in', async () => {
    const pc = device('pc', null)
    const a = pc.add('Hades')
    pc.play(a, 3600)
    const before = backend.requests()
    await pc.sync.syncNow()
    expect(backend.requests()).toBe(before)
    expect(pc.sync.progress()).toMatchObject({ sync: { status: 'local' }, totals: { playtimeSeconds: 3600 } })
    expect(pc.sync.progress().xp).toBeGreaterThan(0)

    pc.signIn('alice')
    await pc.sync.syncNow()
    const phone = device('phone')
    await phone.sync.syncNow()
    expect(phone.sync.progress().totals.playtimeSeconds).toBe(3600)
  })

  it("doesn't mix up accounts on a shared device", async () => {
    const pc = device('pc', 'alice')
    const elsewhere = device('alices-phone', 'alice')
    elsewhere.play(elsewhere.add('Alto', 'android'), 5000)
    await elsewhere.sync.syncNow()
    const a = pc.add('Hades')
    await pc.sync.syncNow()
    expect(pc.sync.progress().totals.playtimeSeconds).toBe(5000)

    // Bob signs in on the same PC: Alice's phone time is not his.
    pc.signIn('bob')
    await pc.sync.syncNow()
    expect(pc.sync.progress().totals.playtimeSeconds).toBe(0)
    expect(pc.game(a).playtimeSeconds).toBe(0)
  })

  it('sends the level friends see, including what other devices added', async () => {
    const pc = device('pc')
    const phone = device('phone')
    pc.play(pc.add('Elden Ring'), 36_000)
    await pc.sync.syncNow()
    phone.play(phone.add('Alto', 'android'), 600)
    await phone.sync.syncNow() // merges the PC's 10 hours, then reports the higher level

    const bob = new AccountClient('http://vanity.test', backend.fetchFn, async () => 't:bob')
    await bob.addFriend('alice')
    const alice = new AccountClient('http://vanity.test', backend.fetchFn, async () => 't:alice')
    await alice.accept('bob')
    const seen = (await bob.friends()).friends[0]
    expect(seen.xp).toBe(phone.sync.progress().xp)
    expect(seen.level).toBe(phone.sync.progress().level.level)
    expect(seen.level).toBeGreaterThan(1)
  })
})
