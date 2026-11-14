import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadItem, Game } from '@shared/types'
import { openDatabase } from '../../db/database'
import { createKv } from '../../db/kv'
import { EpicDriver, folderName, GogDriver, isStrictlyInside } from '../drivers'
import { Gog, gogCodeFromUrl, gogInstallCommand, GOG_AUTH_URL, type GogTokens } from '../gog'
import { Legendary, parseLegendaryLine } from '../legendary'
import { DownloadManager, type DownloadDriver, type RunningDownload } from '../manager'

const FAKE = join(__dirname, 'fake-legendary.mjs')
const CODE = 'a'.repeat(32)

function legendaryIn(dir: string): Legendary {
  return new Legendary({
    binary: FAKE,
    configDir: join(dir, 'legendary'),
    // The stand-in is a script: run it with node, with the same arguments and environment.
    spawn: ((bin: string, args: string[], opts: object) => spawn(process.execPath, [bin, ...args], opts)) as never,
    killTree: async (pid) => void process.kill(pid, 'SIGKILL')
  })
}

const game = (over: Partial<Game> = {}): Game => ({ id: 1, source: 'epic', externalId: 'Sugar', name: 'Rocket League', installed: false, missing: false, coverPath: null, ...over }) as Game

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vanity-dl-'))
  delete process.env.FAKE_LEGENDARY_FAIL
  process.env.FAKE_LEGENDARY_TICK_MS = '15'
})

describe('reading Legendary’s output', () => {
  it('understands the lines Legendary prints while installing', () => {
    expect(parseLegendaryLine('[DLManager] INFO: = Progress: 12.34% (123/456), Running for 00:01:23, ETA: 01:02:03')).toEqual({ type: 'progress', percent: 12.34, etaSeconds: 3723 })
    expect(parseLegendaryLine('[DLManager] INFO:  - Downloaded: 1536.50 MiB, Written: 2048.00 MiB')).toEqual({ type: 'downloaded', bytes: Math.round(1536.5 * 1024 * 1024) })
    expect(parseLegendaryLine('[DLManager] INFO:  + Download\t- 12.50 MiB/s (raw) / 30.00 MiB/s (decompressed)')).toEqual({ type: 'speed', bytesPerSecond: 12.5 * 1024 * 1024 })
    expect(parseLegendaryLine('[cli] INFO: Install size: 90000.00 MiB')).toEqual({ type: 'sizes', kind: 'install', bytes: 90000 * 1024 * 1024 })
    expect(parseLegendaryLine('[cli] INFO: Download size: 40000.25 MiB (Compression savings: 55.5%)')).toMatchObject({ type: 'sizes', kind: 'download' })
    expect(parseLegendaryLine('[cli] INFO: Install path: D:\\Games\\Rocket League')).toEqual({ type: 'path', path: 'D:\\Games\\Rocket League' })
    expect(parseLegendaryLine('[cli] INFO: Finished installation process in 512.33 seconds.')).toEqual({ type: 'finished' })
    expect(parseLegendaryLine('[DLManager] INFO:  + Disk\t- 25.00 MiB/s (write) / 0.00 MiB/s (read)')).toBeNull()
    expect(parseLegendaryLine('[DLManager] INFO:  - Cache usage: 0.00 MiB, active tasks: 2')).toBeNull()
  })

  it('turns its errors into plain words', () => {
    expect(parseLegendaryLine('[cli] ERROR: Login failed! Cannot continue with download process.')).toMatchObject({ type: 'error', specific: true, message: expect.stringMatching(/sign-in has expired/) })
    expect(parseLegendaryLine('[cli] ERROR: Installation cannot proceed, exiting.')).toEqual({ type: 'error', specific: false, message: 'Installation cannot proceed, exiting.' })
    expect(parseLegendaryLine('ValueError: No saved credentials')).toMatchObject({ message: expect.stringMatching(/Sign in to Epic first/) })
    expect(parseLegendaryLine(' ! Failure: Not enough available disk space! 1.00 GiB < 90.00 GiB')).toMatchObject({ message: expect.stringMatching(/enough free space/) })
    expect(parseLegendaryLine("requests.exceptions.ConnectionError: HTTPSConnectionPool(host='x', port=443): Max retries exceeded")).toMatchObject({ message: expect.stringMatching(/reach Epic/) })
    expect(parseLegendaryLine('[cli] ERROR: Could not find "Nope" in list of available games, did you type the name correctly?')).toMatchObject({ message: expect.stringMatching(/doesn't list this game/) })
  })
})

describe('Epic through Legendary', () => {
  it('signs in with the code from Epic’s page, lists the library, and signs out', async () => {
    const l = legendaryIn(dir)
    expect(await l.account()).toBeNull()
    await expect(l.games()).rejects.toThrow(/Sign in to Epic first/)
    await expect(l.login('nope')).rejects.toThrow(/doesn't look like/)
    await expect(l.login('b'.repeat(32))).rejects.toThrow(/didn't accept that code|sign-in failed/i)

    // Pasting the whole JSON value, quotes included, works too.
    expect(await l.login(`"${CODE}"`)).toBe('JordanPlays')
    expect(await l.account()).toBe('JordanPlays')
    expect(await l.games()).toEqual([
      { appName: 'Fortnite', title: 'Fortnite', coverUrl: 'https://cdn1.epicgames.com/fn-tall.jpg', heroUrl: 'https://cdn1.epicgames.com/fn-wide.jpg' },
      { appName: 'Sugar', title: 'Rocket League®', coverUrl: null, heroUrl: null },
      { appName: '9d2d0eb64d5c44529cece33fe2a46482', title: 'Alan Wake 2', coverUrl: null, heroUrl: null }
    ])
    expect(await l.sizes('Sugar')).toEqual({ downloadBytes: 20_000, installBytes: 30_000 })
    await expect(l.sizes('Nope')).rejects.toThrow(/doesn't list this game/)

    await l.logout()
    expect(await l.account()).toBeNull()
  })

  it('installs a game, reporting progress, speed and time left, and knows it is installed', async () => {
    const l = legendaryIn(dir)
    await l.login(CODE)
    const events: string[] = []
    const percents: number[] = []
    const run = l.install('Sugar', join(dir, 'Games'), (e) => {
      events.push(e.type)
      if (e.type === 'progress') percents.push(e.percent)
    })
    await run.done
    expect(new Set(events)).toEqual(new Set(['path', 'sizes', 'progress', 'downloaded', 'speed', 'finished']))
    expect(percents).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(await l.installed()).toEqual([{ appName: 'Sugar', title: 'Rocket League®', installPath: join(dir, 'Games', 'Sugar'), executable: 'Game.exe' }])
  })

  it('stops when asked and carries on from the same place next time', async () => {
    process.env.FAKE_LEGENDARY_TICK_MS = '40'
    const l = legendaryIn(dir)
    await l.login(CODE)
    const first: number[] = []
    const run = l.install('Sugar', join(dir, 'Games'), (e) => e.type === 'progress' && first.push(e.percent))
    await until(() => first.length >= 3)
    await run.stop()
    await expect(run.done).rejects.toThrow('stopped')
    expect(await l.installed()).toEqual([])

    process.env.FAKE_LEGENDARY_TICK_MS = '5'
    const second: number[] = []
    await l.install('Sugar', join(dir, 'Games'), (e) => e.type === 'progress' && second.push(e.percent)).done
    expect(second[0]).toBeGreaterThan(first[0])
    expect(second.at(-1)).toBe(100)
    expect(second.length).toBeLessThan(10)
  })

  it('explains failures', async () => {
    const l = legendaryIn(dir)
    await expect(l.install('Sugar', join(dir, 'Games'), () => {}).done).rejects.toThrow(/Sign in to Epic first/)
    await l.login(CODE)
    process.env.FAKE_LEGENDARY_FAIL = 'space'
    await expect(l.install('Sugar', join(dir, 'Games'), () => {}).done).rejects.toThrow(/enough free space/)
    process.env.FAKE_LEGENDARY_FAIL = 'network'
    await expect(l.install('Sugar', join(dir, 'Games'), () => {}).done).rejects.toThrow(/reach Epic/)
    await expect(l.install('Nope', join(dir, 'Games'), () => {}).done).rejects.toThrow(/doesn't list this game/)
  })

  it('says so when this build has no Epic downloader', async () => {
    const none = new Legendary({ binary: null, configDir: dir, spawn, killTree: async () => {} })
    expect(none.available).toBe(false)
    expect(await none.account()).toBeNull()
    await expect(none.games()).rejects.toThrow(/doesn't include the Epic downloader/)
  })
})

// ---- GOG ---------------------------------------------------------------------------------

function fakeGog() {
  const INSTALLER = Buffer.from('MZ' + 'setup-program-bytes-'.repeat(200))
  const DATA = Buffer.from('game-data-'.repeat(500))
  const state = { validRefresh: 'refresh-1', access: 'access-1', calls: [] as string[], cutAfter: 0, down: false }
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (state.down) throw new TypeError('fetch failed')
    const u = new URL(url)
    state.calls.push(u.hostname + u.pathname)
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization
    if (u.hostname === 'auth.gog.com') {
      const p = u.searchParams
      if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'good-code') return json({ access_token: state.access, refresh_token: state.validRefresh, expires_in: 3600, user_id: '42' })
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === state.validRefresh) {
        state.access = 'access-2'
        state.validRefresh = 'refresh-2'
        return json({ access_token: state.access, refresh_token: state.validRefresh, expires_in: 3600 })
      }
      return json({ error: 'invalid_grant' }, 400)
    }
    if (u.hostname.endsWith('gog.com') && u.hostname !== 'cdn.gog.com' && auth !== `Bearer ${state.access}`) return json({ error: 'unauthorized' }, 401)
    if (u.pathname === '/userData.json') return json({ isLoggedIn: true, username: 'jordan_gog' })
    if (u.pathname === '/account/getFilteredProducts') {
      const page = Number(u.searchParams.get('page'))
      const pages = [
        [{ id: 1207658924, title: 'The Witcher 3: Wild Hunt ', image: '//images-4.gog.com/witcher', isGame: true, worksOn: { Windows: true } }, { id: 5, title: 'A Movie', isGame: false }],
        [{ id: 1423049311, title: 'Cyberpunk 2077', image: '//images-1.gog.com/cp', isGame: true, worksOn: { Windows: true } }, { id: 7, title: 'Mac Only', isGame: true, worksOn: { Windows: false } }]
      ]
      return json({ totalPages: 2, products: pages[page - 1] ?? [] })
    }
    if (u.pathname === '/products/1207658924') {
      return json({
        downloads: {
          installers: [
            { name: 'The Witcher 3 (Polish)', os: 'windows', language: 'pl', total_size: 1, files: [{ id: 'pl1installer0', size: 1, downlink: 'https://api.gog.com/products/1207658924/downlink/installer/pl1installer0' }] },
            {
              name: 'The Witcher 3',
              os: 'windows',
              language: 'en',
              total_size: INSTALLER.length + DATA.length,
              files: [
                { id: 'en1installer0', size: INSTALLER.length, downlink: 'https://api.gog.com/products/1207658924/downlink/installer/en1installer0' },
                { id: 'en1installer1', size: DATA.length, downlink: 'https://api.gog.com/products/1207658924/downlink/installer/en1installer1' }
              ]
            },
            { name: 'Mac', os: 'mac', language: 'en', total_size: 5, files: [{ id: 'mac', size: 5, downlink: 'https://api.gog.com/x' }] }
          ]
        }
      })
    }
    if (u.pathname === '/products/7') return json({ downloads: { installers: [{ os: 'mac', language: 'en', files: [{ id: 'm', size: 1, downlink: 'https://api.gog.com/x' }] }] } })
    if (u.pathname.endsWith('/downlink/installer/en1installer0')) return json({ downlink: 'https://cdn.gog.com/secure/the_witcher_3/setup_the_witcher_3_1.32.exe?token=abc' })
    if (u.pathname.endsWith('/downlink/installer/en1installer1')) return json({ downlink: 'https://cdn.gog.com/secure/the_witcher_3/setup_the_witcher_3_1.32-1.bin?token=abc' })
    if (u.hostname === 'cdn.gog.com') {
      const body = u.pathname.endsWith('.exe') ? INSTALLER : DATA
      const range = /bytes=(\d+)-/.exec((init?.headers as Record<string, string> | undefined)?.range ?? '')
      const from = range ? Number(range[1]) : 0
      if (from >= body.length) return new Response(null, { status: 416 })
      let slice = body.subarray(from)
      let cut = false
      if (state.cutAfter && slice.length > state.cutAfter) {
        slice = slice.subarray(0, state.cutAfter)
        cut = true
      }
      // Chunks are handed over one at a time, like a network; a cut connection fails after the last one.
      let sent = 0
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent < slice.length) {
            controller.enqueue(new Uint8Array(slice.subarray(sent, sent + 1000)))
            sent += 1000
          } else if (cut) controller.error(new Error('connection reset'))
          else controller.close()
        }
      })
      return new Response(stream, { status: from > 0 ? 206 : 200 })
    }
    return json({ error: 'not found' }, 404)
  }
  const box: { tokens: GogTokens | null } = { tokens: null }
  const vault = { load: async () => box.tokens, save: async (t: GogTokens | null) => void (box.tokens = t) }
  return { fetchFn, vault, box, state, INSTALLER, DATA }
}

describe('GOG', () => {
  it('knows its sign-in page and reads the code GOG hands back', () => {
    expect(GOG_AUTH_URL).toMatch(/^https:\/\/auth\.gog\.com\/auth\?client_id=\d+&redirect_uri=https%3A%2F%2Fembed\.gog\.com%2Fon_login_success/)
    expect(gogCodeFromUrl('https://embed.gog.com/on_login_success?origin=client&code=abc123')).toBe('abc123')
    expect(gogCodeFromUrl('https://evil.example/on_login_success?code=abc123')).toBeNull()
    expect(gogCodeFromUrl('https://login.gog.com/login?x=1')).toBeNull()
    expect(gogCodeFromUrl('not a url')).toBeNull()
  })

  it('signs in, keeps the sign-in in the vault, and lists the Windows games you own', async () => {
    const f = fakeGog()
    const gog = new Gog({ fetchFn: f.fetchFn, vault: f.vault })
    expect(await gog.signedIn()).toBe(false)
    expect(await gog.account()).toBeNull()
    await expect(gog.games()).rejects.toThrow(/Sign in to GOG first/)
    await expect(gog.login('bad-code')).rejects.toThrow(/sign-in failed/)

    await gog.login('good-code')
    expect(f.box.tokens).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    expect(await gog.account()).toBe('jordan_gog')
    expect(await gog.games()).toEqual([
      { id: '1207658924', title: 'The Witcher 3: Wild Hunt', coverUrl: 'https://images-4.gog.com/witcher_392.jpg' },
      { id: '1423049311', title: 'Cyberpunk 2077', coverUrl: 'https://images-1.gog.com/cp_392.jpg' }
    ])
    // A new Vanity start reads the sign-in back from the vault.
    expect(await new Gog({ fetchFn: f.fetchFn, vault: f.vault }).account()).toBe('jordan_gog')
  })

  it('renews its sign-in by itself, and asks you to sign in again when GOG has ended it', async () => {
    const f = fakeGog()
    let clock = 1_000_000
    const gog = new Gog({ fetchFn: f.fetchFn, vault: f.vault, now: () => clock })
    await gog.login('good-code')
    clock += 2 * 3_600_000
    expect(await gog.account()).toBe('jordan_gog')
    expect(f.box.tokens?.accessToken).toBe('access-2')

    clock += 2 * 3_600_000
    f.state.validRefresh = 'revoked-elsewhere'
    await expect(gog.games()).rejects.toThrow(/sign-in has expired/)
    expect(f.box.tokens).toBeNull()
    expect(await gog.signedIn()).toBe(false)
  })

  it('picks the English Windows installer and downloads every part of it', async () => {
    const f = fakeGog()
    const gog = new Gog({ fetchFn: f.fetchFn, vault: f.vault })
    await gog.login('good-code')
    const installer = await gog.installer('1207658924')
    expect(installer).toMatchObject({ name: 'The Witcher 3', language: 'en', totalBytes: f.INSTALLER.length + f.DATA.length })
    expect(installer.files.map((x) => x.id)).toEqual(['en1installer0', 'en1installer1'])
    await expect(gog.installer('7')).rejects.toThrow(/doesn't offer a Windows installer/)
    await expect(gog.installer('../x')).rejects.toThrow(/isn't a GOG game/)

    const { url, filename } = await gog.resolve(installer.files[0])
    expect(filename).toBe('setup_the_witcher_3_1.32.exe')
    const dest = join(dir, filename)
    const seen: number[] = []
    await gog.download(url, dest, { signal: new AbortController().signal, onBytes: (n) => seen.push(n), expectedSize: f.INSTALLER.length })
    expect(readFileSync(dest).equals(f.INSTALLER)).toBe(true)
    expect(seen.at(-1)).toBe(f.INSTALLER.length)
    expect(seen.length).toBeGreaterThan(2)
  })

  it('continues a download that was cut off, instead of starting again', async () => {
    const f = fakeGog()
    const gog = new Gog({ fetchFn: f.fetchFn, vault: f.vault })
    await gog.login('good-code')
    const file = (await gog.installer('1207658924')).files[0]
    const { url } = await gog.resolve(file)
    const dest = join(dir, 'setup.exe')
    f.state.cutAfter = 1500
    await expect(gog.download(url, dest, { signal: new AbortController().signal, onBytes: () => {}, expectedSize: file.size })).rejects.toThrow(/interrupted|ended early/)
    expect(statSync(dest).size).toBeGreaterThan(0)
    expect(statSync(dest).size).toBeLessThan(file.size)

    f.state.cutAfter = 0
    const first: number[] = []
    await gog.download(url, dest, { signal: new AbortController().signal, onBytes: (n) => first.push(n), expectedSize: file.size })
    expect(first[0]).toBeGreaterThan(1000) // carried on, didn't restart at zero
    expect(readFileSync(dest).equals(f.INSTALLER)).toBe(true)
    // Already complete: nothing is fetched again.
    const before = f.state.calls.length
    await gog.download(url, dest, { signal: new AbortController().signal, onBytes: () => {}, expectedSize: file.size })
    expect(f.state.calls.length).toBe(before)
  })

  it('builds a silent, elevated install command and safe folder names', () => {
    const c = gogInstallCommand("C:\\Users\\O'Brien\\setup.exe", 'D:\\Games\\The Witcher 3')
    expect(c.file).toBe('powershell.exe')
    const script = c.args.at(-1)!
    expect(script).toContain("-FilePath 'C:\\Users\\O''Brien\\setup.exe'")
    expect(script).toContain("'/VERYSILENT'")
    expect(script).toContain('\'/DIR="D:\\Games\\The Witcher 3"\'')
    expect(script).toContain('-Verb RunAs -Wait')
    expect(folderName('The Witcher 3: Wild Hunt?')).toBe('The Witcher 3 Wild Hunt')
    expect(folderName('  ...  ')).toBe('Game')
    expect(isStrictlyInside('/games/Sugar', '/games')).toBe(true)
    expect(isStrictlyInside('/games', '/games')).toBe(false)
    expect(isStrictlyInside('/games/../etc', '/games')).toBe(false)
    expect(isStrictlyInside('/other/Sugar', '/games')).toBe(false)
  })
})

// ---- the queue ------------------------------------------------------------------------------

/** A store whose downloads advance only when the test says so. */
function manualDriver(store: 'epic' | 'gog' = 'epic') {
  const runs: { game: Game; report: (p: Partial<DownloadItem>) => void; finish(): void; fail(message: string): void; stopped: boolean }[] = []
  const cleaned: number[] = []
  const driver: DownloadDriver = {
    store,
    sizes: async () => ({ downloadBytes: 1000, installBytes: 3000 }),
    run(g, _dir, report): RunningDownload {
      let finish!: () => void
      let fail!: (e: Error) => void
      const done = new Promise<void>((res, rej) => {
        finish = res
        fail = rej
      })
      const entry = { game: g, report, finish, fail: (m: string) => fail(new Error(m)), stopped: false }
      runs.push(entry)
      return {
        done,
        stop: async () => {
          entry.stopped = true
          fail(new Error('stopped'))
        }
      }
    },
    cleanup: async (g) => void cleaned.push(g.id)
  }
  return { driver, runs, cleaned }
}

function queue(opts: { free?: number | null } = {}) {
  const db = openDatabase(':memory:').db
  const kv = createKv(db)
  const games = new Map<number, Game>([
    [1, game({ id: 1, name: 'Rocket League' })],
    [2, game({ id: 2, name: 'Fortnite', externalId: 'Fortnite' })],
    [3, game({ id: 3, name: 'The Witcher 3', source: 'gog', externalId: '1207658924' })],
    [4, game({ id: 4, name: 'Steam Game', source: 'steam', externalId: '620' })]
  ])
  const epic = manualDriver('epic')
  const gogDriver = manualDriver('gog')
  const installed: string[] = []
  const changes: DownloadItem[][] = []
  const make = (): DownloadManager =>
    new DownloadManager({
      kv,
      drivers: [epic.driver, gogDriver.driver],
      getGame: (id) => games.get(id) ?? null,
      defaultDir: '/games',
      freeSpace: async () => (opts.free === undefined ? 100_000_000_000 : opts.free),
      onInstalled: (g) => {
        installed.push(g.name)
        games.set(g.id, { ...g, installed: true })
      },
      onChange: (items) => changes.push(items)
    })
  const manager = make()
  const states = (m = manager): string[] => m.list().map((i) => `${i.name}:${i.state}`)
  return { manager, make, epic, gog: gogDriver, games, installed, changes, states, kv }
}

describe('the download queue', () => {
  it('plans an install: sizes, folder and free space', async () => {
    const q = queue()
    expect(await q.manager.plan(1)).toEqual({ store: 'epic', downloadBytes: 1000, installBytes: 3000, installDir: '/games', freeBytes: 100_000_000_000, enoughSpace: true })
    expect((await q.manager.plan(1, '/mnt/big')).installDir).toBe('/mnt/big')
    await expect(q.manager.plan(4)).rejects.toThrow(/can't install Steam Game by itself/)
    await expect(q.manager.plan(99)).rejects.toThrow(/no longer in your library/)
    expect(q.manager.canInstall(q.games.get(1)!)).toBe(true)
    expect(q.manager.canInstall(q.games.get(4)!)).toBe(false)
  })

  it('refuses to start when the drive clearly has no room', async () => {
    const q = queue({ free: 1000 })
    expect((await q.manager.plan(1)).enoughSpace).toBe(false)
    await expect(q.manager.enqueue(1, '/games')).rejects.toThrow(/enough free space/)
    expect(q.manager.list()).toEqual([])
    // Free space that can't be read doesn't block the install.
    expect((await queue({ free: null }).manager.plan(1)).enoughSpace).toBe(true)
  })

  it('downloads one game at a time, in order, and remembers the chosen folder', async () => {
    const q = queue()
    await q.manager.enqueue(1, '/mnt/big')
    await q.manager.enqueue(2, '/mnt/big')
    await q.manager.enqueue(3, '/mnt/big')
    await until(() => q.epic.runs.length === 1)
    expect(q.states()).toEqual(['Rocket League:preparing', 'Fortnite:queued', 'The Witcher 3:queued'])
    expect(q.manager.installDir()).toBe('/mnt/big')

    q.epic.runs[0].report({ percent: 40, downloadedBytes: 400, speedBps: 1_000_000, etaSeconds: 90 })
    expect(q.manager.list()[0]).toMatchObject({ state: 'downloading', percent: 40, downloadedBytes: 400, speedBps: 1_000_000, etaSeconds: 90, totalBytes: 1000 })

    q.epic.runs[0].finish()
    await until(() => q.epic.runs.length === 2)
    expect(q.states()).toEqual(['Rocket League:done', 'Fortnite:preparing', 'The Witcher 3:queued'])
    expect(q.installed).toEqual(['Rocket League'])
    expect(q.manager.list()[0]).toMatchObject({ percent: 100, speedBps: 0, etaSeconds: null })

    q.epic.runs[1].finish()
    await until(() => q.gog.runs.length === 1)
    q.gog.runs[0].report({ state: 'installing', percent: 99 })
    expect(q.states()[2]).toBe('The Witcher 3:installing')
    q.gog.runs[0].finish()
    await until(() => q.installed.length === 3)
    expect(q.states()).toEqual(['Rocket League:done', 'Fortnite:done', 'The Witcher 3:done'])

    q.manager.clearFinished()
    expect(q.manager.list()).toEqual([])
  })

  it('pauses and resumes: the next game starts while one is paused', async () => {
    const q = queue()
    await q.manager.enqueue(1, '/games')
    await q.manager.enqueue(2, '/games')
    await until(() => q.epic.runs.length === 1)
    q.epic.runs[0].report({ percent: 30 })
    await q.manager.pause(q.manager.list()[0].id)
    await until(() => q.epic.runs.length === 2)
    expect(q.epic.runs[0].stopped).toBe(true)
    expect(q.states()).toEqual(['Rocket League:paused', 'Fortnite:preparing'])
    expect(q.manager.list()[0].percent).toBe(30)

    await q.manager.resume(q.manager.list()[0].id)
    expect(q.states()[0]).toBe('Rocket League:queued')
    q.epic.runs[1].finish()
    await until(() => q.epic.runs.length === 3)
    expect(q.epic.runs[2].game.name).toBe('Rocket League')
    // Pausing something that is only waiting holds it back.
    await q.manager.enqueue(3, '/games')
    await q.manager.pause(q.manager.list().find((i) => i.name === 'The Witcher 3')!.id)
    q.epic.runs[2].finish()
    await until(() => q.installed.length === 2)
    await new Promise((r) => setTimeout(r, 30))
    expect(q.gog.runs).toHaveLength(0)
    expect(q.states()).toContain('The Witcher 3:paused')
  })

  it('cancels: stops it, deletes what it fetched, and moves on', async () => {
    const q = queue()
    await q.manager.enqueue(1, '/games')
    await q.manager.enqueue(2, '/games')
    await until(() => q.epic.runs.length === 1)
    await q.manager.cancel(q.manager.list()[0].id)
    await until(() => q.epic.runs.length === 2)
    expect(q.states()).toEqual(['Fortnite:preparing'])
    expect(q.epic.cleaned).toEqual([1])
    expect(q.installed).toEqual([])
    // Cancelling one that is waiting just removes it.
    await q.manager.enqueue(3, '/games')
    await q.manager.cancel(q.manager.list().find((i) => i.name === 'The Witcher 3')!.id)
    expect(q.states()).toEqual(['Fortnite:preparing'])
  })

  it('shows why a download failed, lets you retry, and carries on with the rest', async () => {
    const q = queue()
    await q.manager.enqueue(1, '/games')
    await q.manager.enqueue(2, '/games')
    await until(() => q.epic.runs.length === 1)
    q.epic.runs[0].fail("Couldn't reach Epic. Check your internet connection and try again.")
    await until(() => q.epic.runs.length === 2)
    expect(q.manager.list()[0]).toMatchObject({ state: 'failed', error: "Couldn't reach Epic. Check your internet connection and try again.", speedBps: 0 })
    expect(q.states()[1]).toBe('Fortnite:preparing')

    // Clicking Install again on a failed game retries it rather than adding a second entry.
    await q.manager.enqueue(1, '/games')
    expect(q.states()).toEqual(['Rocket League:queued', 'Fortnite:preparing'])
    expect(q.manager.list()[0].error).toBeNull()
  })

  it('remembers the queue between launches, paused', async () => {
    const q = queue()
    await q.manager.enqueue(1, '/games')
    await q.manager.enqueue(2, '/games')
    await until(() => q.epic.runs.length === 1)
    q.epic.runs[0].report({ percent: 55, downloadedBytes: 550 })
    await q.manager.shutdown()
    await new Promise((r) => setTimeout(r, 20))

    const restarted = q.make()
    expect(q.states(restarted)).toEqual(['Rocket League:paused', 'Fortnite:queued'])
    expect(restarted.list()[0]).toMatchObject({ percent: 55, downloadedBytes: 550, speedBps: 0 })
    // Nothing starts by itself after a restart until you resume or add something.
    expect(q.epic.runs).toHaveLength(1)
    await restarted.resume(restarted.list()[0].id)
    await until(() => q.epic.runs.length === 2)
  })

  it('reports changes to the screen without flooding it', async () => {
    const q = queue()
    await q.manager.enqueue(1, '/games')
    await until(() => q.epic.runs.length === 1)
    const before = q.changes.length
    for (let i = 1; i <= 200; i++) q.epic.runs[0].report({ percent: i / 2 })
    expect(q.changes.length - before).toBeLessThanOrEqual(2)
    await new Promise((r) => setTimeout(r, 600))
    expect(q.changes.at(-1)![0].percent).toBe(100)
  })
})

describe('the real drivers through the queue', () => {
  it('installs an Epic game end to end, and cleans up a cancelled one', async () => {
    process.env.FAKE_LEGENDARY_TICK_MS = '25'
    const l = legendaryIn(dir)
    await l.login(CODE)
    const db = openDatabase(':memory:').db
    const games = new Map<number, Game>([[1, game({ id: 1 })], [2, game({ id: 2, name: 'Fortnite', externalId: 'Fortnite' })]])
    const done = vi.fn()
    const logs: string[] = []
    const manager = new DownloadManager({
      kv: createKv(db),
      drivers: [new EpicDriver(l)],
      getGame: (id) => games.get(id) ?? null,
      defaultDir: join(dir, 'Games'),
      freeSpace: async () => 1e12,
      onInstalled: done,
      onChange: () => {},
      log: (_id, line) => logs.push(line)
    })
    expect(await manager.plan(1)).toMatchObject({ downloadBytes: 20_000, installBytes: 30_000, enoughSpace: true })
    await manager.enqueue(1, join(dir, 'Games'))
    await until(() => manager.list()[0].state === 'done', 8000)
    expect(done).toHaveBeenCalledTimes(1)
    expect(manager.list()[0]).toMatchObject({ percent: 100, totalBytes: Math.round((20_000 / 1048576) * 100) / 100 * 1048576 > 0 ? expect.any(Number) : 0 })
    expect((await l.installed()).map((g) => g.appName)).toEqual(['Sugar'])
    expect(logs.some((line) => line.includes('Finished installation process'))).toBe(true)

    await manager.enqueue(2, join(dir, 'Games'))
    await until(() => manager.list().find((i) => i.gameId === 2)!.percent >= 20, 8000)
    expect(readdirSync(join(dir, 'Games', 'Fortnite')).length).toBeGreaterThan(0)
    await manager.cancel(manager.list().find((i) => i.gameId === 2)!.id)
    await until(() => manager.list().length === 1)
    await until(() => !existsSync(join(dir, 'Games', 'Fortnite')))
    // The finished game next to it is untouched.
    expect(existsSync(join(dir, 'Games', 'Sugar'))).toBe(true)
  })

  it('installs a GOG game end to end: downloads the installer, runs it silently, tidies up', async () => {
    const f = fakeGog()
    const gog = new Gog({ fetchFn: f.fetchFn, vault: f.vault })
    await gog.login('good-code')
    const ran: { file: string; args: string[]; setupExisted: boolean; dataExisted: boolean }[] = []
    const temp = join(dir, 'temp')
    const driver = new GogDriver({
      gog,
      tempDir: temp,
      exec: async (file, args) => {
        const setup = join(temp, '1207658924', 'setup_the_witcher_3_1.32.exe')
        ran.push({ file, args, setupExisted: existsSync(setup) && readFileSync(setup).equals(f.INSTALLER), dataExisted: existsSync(join(temp, '1207658924', 'setup_the_witcher_3_1.32-1.bin')) })
        return 0
      }
    })
    const g = game({ id: 3, source: 'gog', externalId: '1207658924', name: 'The Witcher 3: Wild Hunt' })
    expect(await driver.sizes(g)).toEqual({ downloadBytes: f.INSTALLER.length + f.DATA.length, installBytes: 0 })
    const reports: Partial<DownloadItem>[] = []
    await driver.run(g, 'D:\\Games', (p) => reports.push(p), () => {}).done

    expect(ran).toHaveLength(1)
    expect(ran[0]).toMatchObject({ file: 'powershell.exe', setupExisted: true, dataExisted: true })
    expect(ran[0].args.at(-1)).toContain('The Witcher 3 Wild Hunt')
    expect(reports.some((r) => r.state === 'installing')).toBe(true)
    expect(Math.max(...reports.map((r) => r.downloadedBytes ?? 0))).toBe(f.INSTALLER.length + f.DATA.length)
    expect(existsSync(join(temp, '1207658924'))).toBe(false)
  })

  it('stops a GOG download when paused and continues it later; a refused installer is explained', async () => {
    const f = fakeGog()
    const gog = new Gog({ fetchFn: f.fetchFn, vault: f.vault })
    await gog.login('good-code')
    const temp = join(dir, 'temp')
    let exit = 1
    const driver = new GogDriver({ gog, tempDir: temp, exec: async () => exit })
    const g = game({ id: 3, source: 'gog', externalId: '1207658924', name: 'The Witcher 3' })

    // A partial file from an earlier, paused attempt is continued rather than fetched again.
    mkdirSync(join(temp, '1207658924'), { recursive: true })
    writeFileSync(join(temp, '1207658924', 'setup_the_witcher_3_1.32.exe'), f.INSTALLER.subarray(0, 1234))
    await expect(driver.run(g, '/games', () => {}, () => {}).done).rejects.toThrow(/choose Yes, then press Resume/)
    expect(readFileSync(join(temp, '1207658924', 'setup_the_witcher_3_1.32.exe')).equals(f.INSTALLER)).toBe(true)

    // Resume: nothing is downloaded again, the installer just runs.
    exit = 0
    const before = f.state.calls.filter((c) => c.startsWith('cdn.gog.com')).length
    await driver.run(g, '/games', () => {}, () => {}).done
    expect(f.state.calls.filter((c) => c.startsWith('cdn.gog.com')).length).toBe(before)

    await driver.cleanup(g)
    expect(existsSync(join(temp, '1207658924'))).toBe(false)
  })
})
