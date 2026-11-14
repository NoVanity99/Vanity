import { describe, expect, it, vi } from 'vitest'
import { APK_URL, MobileUpdater, type MobileUpdateDeps } from '../update'

const CHANGELOG = '# Changelog\n\n## 2.0.0 (2026-01-02)\n- Big new thing.\n\n## 1.0.0 (2026-01-01)\n- First.\n'

function make(over: Partial<MobileUpdateDeps> = {}): { updater: MobileUpdater; openUrl: ReturnType<typeof vi.fn> } {
  const openUrl = vi.fn(async () => {})
  const updater = new MobileUpdater({
    currentVersion: '1.0.0',
    fetchText: async (url) => (url.endsWith('latest.yml') ? 'version: 2.0.0\n' : CHANGELOG),
    openUrl,
    onUpdate: () => {},
    ...over
  })
  return { updater, openUrl }
}

describe('MobileUpdater', () => {
  it('offers a newer release with its patch notes', async () => {
    const { updater } = make()
    const s = await updater.check()
    expect(s.available).toBe(true)
    expect(s.latest).toBe('2.0.0')
    expect(s.notes[0].changes).toEqual(['Big new thing.'])
  })

  it('is quiet when already on the newest version', async () => {
    const { updater } = make({ currentVersion: '2.0.0' })
    expect((await updater.check()).available).toBe(false)
  })

  it('downloads and installs inside the app, reporting progress', async () => {
    const seen: (string | null)[] = []
    const install = vi.fn(async (_url: string, onProgress: (p: number) => void) => {
      onProgress(40)
      onProgress(100)
    })
    const { updater, openUrl } = make({ install, onUpdate: (s) => seen.push(s.applying) })
    await updater.check()
    await updater.apply()
    expect(install).toHaveBeenCalledWith(APK_URL, expect.any(Function))
    expect(seen).toContain('Downloading 40%')
    expect(openUrl).not.toHaveBeenCalled()
    expect(updater.state().applying).toBeNull()
  })

  it('falls back to the browser download when the in-app install fails', async () => {
    const { updater, openUrl } = make({ install: async () => Promise.reject(new Error('nope')) })
    await updater.check()
    await updater.apply()
    expect(openUrl).toHaveBeenCalledWith(APK_URL)
    expect(updater.state().applying).toBeNull()
  })

  it('checks again when coming back only if the last check is old', async () => {
    let now = 1_000_000
    const fetchText = vi.fn(async (url: string) => (url.endsWith('latest.yml') ? 'version: 1.0.0\n' : CHANGELOG))
    const { updater } = make({ fetchText, now: () => now })
    await updater.check()
    updater.checkIfStale()
    expect(fetchText).toHaveBeenCalledTimes(1)
    now += 5 * 60_000
    updater.checkIfStale()
    expect(fetchText).toHaveBeenCalledTimes(2)
  })
})
