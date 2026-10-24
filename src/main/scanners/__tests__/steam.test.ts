import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAppManifest, parseLibraryFolders, scanSteamRoot } from '../steam'
import { makeTree } from './helpers'

const acf = (appid: string, name: string, dir: string, flags = '4') =>
  `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"name"\t\t"${name}"\n\t"StateFlags"\t\t"${flags}"\n\t"installdir"\t\t"${dir}"\n}`

describe('steam scanner', () => {
  it('reads the old libraryfolders format and de-duplicates the root', () => {
    const text = `"LibraryFolders" { "TimeNextStatsReport" "1" "1" "D:\\\\Games\\\\Steam" "2" "C:\\\\Steam" }`
    expect(parseLibraryFolders(text, 'C:\\Steam')).toEqual(['C:\\Steam', 'D:\\Games\\Steam'])
  })

  it('skips redistributables and games that are not fully installed', () => {
    expect(parseAppManifest(acf('228980', 'Steamworks Common Redistributables', 'Steamworks Shared'), '/lib')).toBeNull()
    expect(parseAppManifest(acf('1', 'Downloading', 'x', '1026'), '/lib')).toBeNull()
    // 6 = fully installed + update required: still playable
    expect(parseAppManifest(acf('2', 'Needs Update', 'y', '6'), '/lib')?.name).toBe('Needs Update')
  })

  it('finds games across all library folders', async () => {
    const second = makeTree({ 'steamapps/appmanifest_1245620.acf': acf('1245620', 'ELDEN RING', 'ELDEN RING') })
    const root = makeTree({
      'steamapps/libraryfolders.vdf': `"libraryfolders" { "0" { "path" "ROOT" } "1" { "path" "${second.replace(/\\/g, '\\\\')}" } }`,
      'steamapps/appmanifest_620.acf': acf('620', 'Portal 2', 'Portal 2'),
      'steamapps/appmanifest_228980.acf': acf('228980', 'Steamworks Common Redistributables', 'Steamworks Shared'),
      'steamapps/appmanifest_bad.acf': 'not a manifest'
    })
    const games = await scanSteamRoot(root)
    expect(games.map((g) => g.name).sort()).toEqual(['ELDEN RING', 'Portal 2'])
    const er = games.find((g) => g.externalId === '1245620')!
    expect(er.installPath).toBe(join(second, 'steamapps', 'common', 'ELDEN RING'))
    expect(er.source).toBe('steam')
  })

  it('returns nothing (without throwing) for a missing Steam folder', async () => {
    expect(await scanSteamRoot('/definitely/not/here')).toEqual([])
  })
})
