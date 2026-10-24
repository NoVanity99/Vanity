import { describe, expect, it } from 'vitest'
import type { DetectedGame } from '@shared/types'
import { openDatabase } from '../../db/database'
import { createSqliteStore } from '../store'

const portal: DetectedGame = { source: 'steam', externalId: '620', name: 'Portal 2', installPath: 'C:\\Steam\\common\\Portal 2', executablePath: null }

function store(now = () => 1000) {
  return createSqliteStore(openDatabase(':memory:').db, now)
}

describe('sqlite store', () => {
  it('inserts new games with defaults', () => {
    const s = store()
    const { added, games } = s.upsert([portal])
    expect(added).toBe(1)
    expect(games[0]).toMatchObject({
      name: 'Portal 2',
      source: 'steam',
      externalId: '620',
      favorite: false,
      hidden: false,
      missing: false,
      addedAt: 1000,
      playtimeSeconds: 0,
      genres: []
    })
  })

  it('updates in place on rescan and keeps user fields', () => {
    const s = store()
    const [g] = s.upsert([portal]).games
    s.update(g.id, { favorite: true, hidden: true })
    const r = s.upsert([{ ...portal, installPath: 'D:\\Steam\\common\\Portal 2' }])
    expect(r).toMatchObject({ added: 0, updated: 1 })
    expect(s.list()).toHaveLength(1)
    expect(s.get(g.id)).toMatchObject({ favorite: true, hidden: true, installPath: 'D:\\Steam\\common\\Portal 2', addedAt: 1000 })
  })

  it('keeps a name the user changed', () => {
    const s = store()
    const [g] = s.upsert([portal]).games
    s.update(g.id, { name: '  Portal Two ' })
    s.upsert([portal])
    expect(s.get(g.id)?.name).toBe('Portal Two')
  })

  it('ignores blank names and unknown ids', () => {
    const s = store()
    const [g] = s.upsert([portal]).games
    expect(s.update(g.id, { name: '   ' })?.name).toBe('Portal 2')
    expect(s.update(999, { favorite: true })).toBeNull()
  })

  it('treats the same ID from different sources as different games', () => {
    const s = store()
    s.upsert([portal, { ...portal, source: 'gog' }])
    expect(s.list()).toHaveLength(2)
  })

  it('marks missing games and removes games', () => {
    const s = store()
    const [a] = s.upsert([portal, { ...portal, externalId: '400', name: 'Portal' }]).games
    expect(s.markMissing('steam', ['400'])).toBe(1)
    expect(s.markMissing('steam', ['400'])).toBe(0) // already flagged
    expect(s.get(a.id)?.missing).toBe(true)
    s.remove(a.id)
    expect(s.list().map((g) => g.name)).toEqual(['Portal'])
  })

  it('sorts by name, ignoring case', () => {
    const s = store()
    s.upsert([
      { ...portal, externalId: '1', name: 'celeste' },
      { ...portal, externalId: '2', name: 'Baldur’s Gate 3' },
      { ...portal, externalId: '3', name: 'Alan Wake 2' }
    ])
    expect(s.list().map((g) => g.name)).toEqual(['Alan Wake 2', 'Baldur’s Gate 3', 'celeste'])
  })
})

describe('executable override', () => {
  it('keeps an exe the user picked across rescans', () => {
    const s = store()
    const ubi: DetectedGame = { source: 'ubisoft', externalId: '5059', name: 'AC', installPath: 'C:\\AC', executablePath: 'C:\\AC\\wrong.exe' }
    const [g] = s.upsert([ubi]).games
    s.update(g.id, { executablePath: 'C:\\AC\\ACValhalla.exe' })
    s.upsert([ubi])
    expect(s.get(g.id)?.executablePath).toBe('C:\\AC\\ACValhalla.exe')
  })
})
