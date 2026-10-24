import { describe, expect, it, vi } from 'vitest'
import type { GameCandidate, Settings } from '@shared/types'
import { openDatabase } from '../../db/database'
import type { Scanner } from '../../scanners/types'
import { filterCandidates, runScan } from '../scan'
import { createSqliteStore, isSameOrInside } from '../store'

const createMemoryStore = () => createSqliteStore(openDatabase(':memory:').db)

const settings: Settings = {
  steamGridDbApiKey: '',
  igdbClientId: '',
  igdbClientSecret: '',
  customFolders: ['/games'],
  enabledSources: { steam: true, epic: true, gog: true, ea: false, ubisoft: true, custom: true },
  ignoredExecutables: ['/games/Declined/declined.exe'],
  theme: 'midnight',
  font: 'system',
  ambientBackground: true,
  minimizeWhilePlaying: false,
  musicFolder: null,
  musicVolume: 0.5
}

const candidate = (name: string, folder: string): GameCandidate => ({
  source: 'custom',
  externalId: `${folder}/${name}.exe`.toLowerCase(),
  name,
  installPath: folder,
  executablePath: `${folder}/${name}.exe`,
  alternatives: []
})

const fakeScanners: Scanner[] = [
  {
    source: 'steam',
    isAvailable: async () => true,
    scan: async () => [{ source: 'steam', externalId: '620', name: 'Portal 2', installPath: '/steam/common/Portal 2', executablePath: null }]
  },
  { source: 'epic', isAvailable: async () => false, scan: async () => [] },
  { source: 'gog', isAvailable: async () => true, scan: async () => { throw new Error('registry exploded') } },
  { source: 'ea', isAvailable: async () => true, scan: async () => { throw new Error('should not run: disabled') } },
  {
    source: 'custom',
    isAvailable: async () => true,
    scan: async () => [
      candidate('Celeste', '/games/Celeste'),
      candidate('declined', '/games/Declined'),
      candidate('portal2', '/steam/common/Portal 2') // custom folder overlapping a Steam install
    ]
  }
]

describe('runScan', () => {
  it('isolates failures, skips missing launchers and disabled sources', async () => {
    const store = createMemoryStore()
    const onProgress = vi.fn()
    const summary = await runScan({ settings, store, onProgress, scannerList: fakeScanners })

    const status = Object.fromEntries(summary.progress.map((p) => [p.source, p.status]))
    expect(status).toEqual({ steam: 'done', epic: 'skipped', gog: 'error', custom: 'done' })
    expect(summary.progress.find((p) => p.source === 'gog')?.message).toBe('registry exploded')
    expect(summary.added).toBe(1)
    expect(summary.candidates.map((c) => c.name)).toEqual(['Celeste'])
    expect(onProgress).toHaveBeenCalled()
  })

  it('does not create duplicates on rescan', async () => {
    const store = createMemoryStore()
    await runScan({ settings, store, onProgress: () => {}, scannerList: fakeScanners })
    const second = await runScan({ settings, store, onProgress: () => {}, scannerList: fakeScanners })
    expect(second.added).toBe(0)
    expect(second.updated).toBe(1)
    expect(store.list()).toHaveLength(1)
  })

  it('flags games that a successful scan no longer finds, and un-flags them when they return', async () => {
    const store = createMemoryStore()
    let installed = true
    const steam: Scanner = {
      source: 'steam',
      isAvailable: async () => true,
      scan: async () => (installed ? [{ source: 'steam', externalId: '620', name: 'Portal 2', installPath: '/p', executablePath: null }] : [])
    }
    const run = () => runScan({ settings, store, onProgress: () => {}, scannerList: [steam] })
    await run()
    installed = false
    expect((await run()).missing).toBe(1)
    expect(store.list()[0].missing).toBe(true)
    installed = true
    await run()
    expect(store.list()[0].missing).toBe(false)
  })

  it('does not flag games when their source failed', async () => {
    const store = createMemoryStore()
    store.upsert([{ source: 'gog', externalId: '1', name: 'Witcher', installPath: '/w', executablePath: null }])
    await runScan({ settings, store, onProgress: () => {}, scannerList: fakeScanners })
    expect(store.list().find((g) => g.source === 'gog')?.missing).toBe(false)
  })

  it('flags custom games whose exe was deleted', async () => {
    const store = createMemoryStore()
    store.upsert([{ source: 'manual', externalId: '/gone/game.exe', name: 'Gone', installPath: '/gone', executablePath: '/gone/game.exe' }])
    const summary = await runScan({ settings, store, onProgress: () => {}, scannerList: [] })
    expect(summary.missing).toBe(1)
    expect(store.list()[0].missing).toBe(true)
  })

  it('stops suggesting custom games once they are in the library', () => {
    const store = createMemoryStore()
    const c = candidate('Celeste', '/games/Celeste')
    store.upsert([c])
    expect(filterCandidates([c], store.list(), [])).toEqual([])
  })
})

describe('isSameOrInside', () => {
  it('compares folders case-insensitively', () => {
    expect(isSameOrInside('/Steam/common/Game', '/steam')).toBe(true)
    expect(isSameOrInside('/steam', '/steam/common')).toBe(false)
    expect(isSameOrInside('/steamy', '/steam')).toBe(false)
  })
})
