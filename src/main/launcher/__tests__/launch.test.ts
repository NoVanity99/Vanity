import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Game } from '@shared/types'
import { launchGame, launchUri, LaunchError, type LaunchDeps } from '../launch'

const game = (over: Partial<Game>): Game => ({
  id: 1,
  source: 'custom',
  externalId: 'x',
  name: 'Celeste',
  installPath: 'C:\\Games\\Celeste',
  executablePath: 'C:\\Games\\Celeste\\Celeste.exe',
  favorite: false,
  hidden: false,
  missing: false,
  addedAt: 0,
  lastPlayedAt: null,
  playtimeSeconds: 0,
  description: null,
  genres: [],
  releaseDate: null,
  developer: null,
  coverPath: null,
  heroPath: null,
  logoPath: null,
  iconPath: null,
  ...over
})

function fakeChild(event: 'spawn' | 'error', error?: NodeJS.ErrnoException) {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  setTimeout(() => (event === 'spawn' ? child.emit('spawn') : child.emit('error', error)), 0)
  return child
}

function deps(over: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    openExternal: vi.fn(async () => {}),
    openPath: vi.fn(async () => ''),
    spawn: vi.fn(() => fakeChild('spawn')) as unknown as LaunchDeps['spawn'],
    exists: vi.fn(async () => true),
    ...over
  }
}

describe('launchUri', () => {
  it('builds Steam and Epic URIs', () => {
    expect(launchUri(game({ source: 'steam', externalId: '620' }))).toBe('steam://rungameid/620')
    expect(launchUri(game({ source: 'epic', externalId: 'Fortnite' }))).toBe(
      'com.epicgames.launcher://apps/Fortnite?action=launch&silent=true'
    )
    expect(launchUri(game({ source: 'epic', externalId: 'a:b c' }))).toContain('apps/a%3Ab%20c?')
    expect(launchUri(game({ source: 'gog' }))).toBeNull()
  })
})

describe('launchGame', () => {
  it('opens the Steam URI', async () => {
    const d = deps()
    expect(await launchGame(game({ source: 'steam', externalId: '620' }), d)).toEqual({ method: 'uri' })
    expect(d.openExternal).toHaveBeenCalledWith('steam://rungameid/620')
    expect(d.spawn).not.toHaveBeenCalled()
  })

  it('reports a missing launcher clearly', async () => {
    const d = deps({ openExternal: vi.fn(async () => Promise.reject(new Error('no handler'))) })
    await expect(launchGame(game({ source: 'epic' }), d)).rejects.toThrow(/Epic Games Launcher.*installed/)
  })

  it('spawns the exe detached, in its own folder', async () => {
    const d = deps()
    const exePath = join('games', 'Celeste', 'Celeste.exe') // host path format, so dirname() works
    const result = await launchGame(game({ executablePath: exePath }), d)
    expect(result.method).toBe('exe')
    expect(result.child).toBeDefined()
    const [exe, args, opts] = vi.mocked(d.spawn).mock.calls[0]
    expect(exe).toBe(exePath)
    expect(args).toEqual([])
    expect(opts).toMatchObject({ detached: true, stdio: 'ignore', cwd: join('games', 'Celeste') })
  })

  it('fails with a clear message when the exe is gone', async () => {
    const d = deps({ exists: vi.fn(async () => false) })
    await expect(launchGame(game({}), d)).rejects.toBeInstanceOf(LaunchError)
    await expect(launchGame(game({}), d)).rejects.toThrow(/moved or uninstalled/)
  })

  it('falls back to the shell (UAC prompt) when the exe needs admin rights', async () => {
    const err = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' })
    const d = deps({ spawn: vi.fn(() => fakeChild('error', err)) as unknown as LaunchDeps['spawn'] })
    expect(await launchGame(game({}), d)).toEqual({ method: 'exe' })
    expect(d.openPath).toHaveBeenCalledWith('C:\\Games\\Celeste\\Celeste.exe')
  })

  it('turns other spawn errors into a LaunchError', async () => {
    const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const d = deps({ spawn: vi.fn(() => fakeChild('error', err)) as unknown as LaunchDeps['spawn'] })
    await expect(launchGame(game({}), d)).rejects.toThrow(/Couldn't start Celeste/)
    expect(d.openPath).not.toHaveBeenCalled()
  })

  it('explains when no exe is known', async () => {
    await expect(launchGame(game({ source: 'ubisoft', executablePath: null }), deps())).rejects.toThrow(/Edit metadata/)
  })
})
