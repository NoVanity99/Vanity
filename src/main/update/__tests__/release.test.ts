import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'
import { notesFromRelease, ReleaseUpdater, type AutoUpdaterLike } from '../release'

function fakeUpdater(behaviour: (u: EventEmitter) => Promise<unknown>) {
  const em = new EventEmitter()
  const u = Object.assign(em, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(() => behaviour(em)),
    quitAndInstall: vi.fn()
  })
  return u as unknown as AutoUpdaterLike & EventEmitter & { checkForUpdates: ReturnType<typeof vi.fn>; quitAndInstall: ReturnType<typeof vi.fn> }
}

describe('notesFromRelease', () => {
  it('turns the release text into a list of changes', () => {
    expect(
      notesFromRelease({ version: '1.0.1', releaseDate: '2026-11-01T10:00:00Z', releaseNotes: '<ul><li>New <b>Big Picture</b> mode</li><li>Fixed R&amp;D bug</li></ul>' })
    ).toEqual([{ version: '1.0.1', date: '2026-11-01', changes: ['New Big Picture mode', 'Fixed R&D bug'] }])
    expect(notesFromRelease({ version: '1.0.1', releaseNotes: null })[0].changes).toEqual(['Improvements and fixes.'])
    expect(notesFromRelease({ version: '2', releaseNotes: [{ version: '2', note: '<p>One</p><p>Two</p>' }] })[0].changes).toEqual(['One', 'Two'])
  })
})

describe('ReleaseUpdater', () => {
  it('downloads in the background, then offers restart to install', async () => {
    const states: UpdateState[] = []
    const u = fakeUpdater(async (em) => {
      em.emit('update-available', { version: '1.0.1', releaseNotes: '<ul><li>Shiny</li></ul>' })
      em.emit('download-progress', { percent: 42.4 })
      setTimeout(() => em.emit('update-downloaded', { version: '1.0.1', releaseNotes: '<ul><li>Shiny</li></ul>' }), 5)
    })
    const r = new ReleaseUpdater({ updater: u, currentVersion: '1.0.0', onUpdate: (s) => states.push(s) })
    expect(u.autoDownload).toBe(true)
    expect(u.autoInstallOnAppQuit).toBe(true)

    await r.check()
    expect(states.some((s) => s.progress === 42)).toBe(true)
    expect(r.state()).toMatchObject({ checking: true, available: false })
    await new Promise((res) => setTimeout(res, 20))
    expect(r.state()).toMatchObject({ mode: 'release', available: true, latest: '1.0.1', checking: false, notes: [{ version: '1.0.1', changes: ['Shiny'] }] })

    await r.check() // nothing more to do once downloaded
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1)
    await r.apply()
    expect(u.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('stays quiet when offline or up to date', async () => {
    const offline = fakeUpdater(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    })
    const r = new ReleaseUpdater({ updater: offline, currentVersion: '1.0.0', onUpdate: () => {} })
    const s = await r.check()
    expect(s).toMatchObject({ available: false, checking: false, error: expect.stringMatching(/try again later/) })
    await expect(r.apply()).rejects.toThrow(/No update/)

    const upToDate = fakeUpdater(async (em) => void em.emit('update-not-available', { version: '1.0.0' }))
    const r2 = new ReleaseUpdater({ updater: upToDate, currentVersion: '1.0.0', onUpdate: () => {} })
    expect(await r2.check()).toMatchObject({ available: false, checking: false, error: null, latest: '1.0.0' })
  })
})
