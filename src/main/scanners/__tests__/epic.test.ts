import { describe, expect, it } from 'vitest'
import { parseEpicManifest, scanEpicManifests } from '../epic'
import { makeTree } from './helpers'

const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    DisplayName: 'Fortnite',
    AppName: 'Fortnite',
    MainGameAppName: 'Fortnite',
    InstallLocation: '/games/Fortnite',
    LaunchExecutable: 'FortniteGame/Binaries/Win64/FortniteLauncher.exe',
    AppCategories: ['public', 'games', 'applications'],
    bIsIncompleteInstall: false,
    ...over
  })

describe('epic scanner', () => {
  it('parses a game manifest', () => {
    const g = parseEpicManifest('\uFEFF' + manifest())!
    expect(g).toMatchObject({ source: 'epic', externalId: 'Fortnite', name: 'Fortnite' })
    expect(g.executablePath).toContain('FortniteLauncher.exe')
  })

  it('skips DLC, engines, incomplete installs and bad JSON', () => {
    expect(parseEpicManifest(manifest({ AppName: 'DLC1' }))).toBeNull()
    expect(parseEpicManifest(manifest({ AppCategories: ['engines'] }))).toBeNull()
    expect(parseEpicManifest(manifest({ bIsIncompleteInstall: true }))).toBeNull()
    expect(parseEpicManifest('{oops')).toBeNull()
  })

  it('only returns games whose install folder exists', async () => {
    const games = makeTree({ 'Hades/Hades.exe': 10 })
    const dir = makeTree({
      'a.item': manifest({ DisplayName: 'Hades', AppName: 'Min', MainGameAppName: 'Min', InstallLocation: `${games}/Hades` }),
      'b.item': manifest({ AppName: 'Gone', MainGameAppName: 'Gone', InstallLocation: `${games}/Gone` }),
      'notes.txt': 'ignore me'
    })
    const found = await scanEpicManifests(dir)
    expect(found.map((g) => g.name)).toEqual(['Hades'])
  })
})
