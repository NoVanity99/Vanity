import { describe, expect, it } from 'vitest'
import { parseEaRegistry, parseInstallerData } from '../ea'
import { GOG_GAMES_KEY, parseGogRegistry } from '../gog'
import { parseUbisoftRegistry, UBISOFT_INSTALLS_KEY } from '../ubisoft'
import { cleanPathValue } from '../registryPaths'
import { buildScript, getValue, parseRegistryJson, readRegistryKeys } from '../../util/registry'

const UNINSTALL = 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'

describe('registry helpers', () => {
  it('parses PowerShell JSON, including single objects and a BOM', () => {
    const one = '\uFEFF{"path":"HKLM\\\\X","values":{"A":"1"},"subkeys":{"name":"s","values":{}}}'
    expect(parseRegistryJson(one)).toEqual([{ path: 'HKLM\\X', values: { A: '1' }, subkeys: [{ name: 's', values: {} }] }])
    expect(parseRegistryJson('')).toEqual([])
  })

  it('looks values up case-insensitively', () => {
    expect(getValue({ InstallDir: 'x' }, 'installdir')).toBe('x')
  })

  it('escapes single quotes in key paths', () => {
    expect(buildScript(["HKLM\\It's"])).toContain("'HKLM\\It''s'")
  })

  it('returns [] instead of throwing off Windows', async () => {
    if (process.platform !== 'win32') expect(await readRegistryKeys(['HKLM\\SOFTWARE'])).toEqual([])
  })

  it('cleans path values', () => {
    expect(cleanPathValue('"C:\\Games\\X\\x.exe",0')).toBe('C:\\Games\\X\\x.exe')
    expect(cleanPathValue('D:/Ubisoft/Game/')).toBe('D:\\Ubisoft\\Game')
    expect(cleanPathValue('')).toBeNull()
  })
})

describe('gog scanner', () => {
  it('reads games and skips DLC', () => {
    const games = parseGogRegistry({
      path: GOG_GAMES_KEY,
      values: {},
      subkeys: [
        { name: '1207664663', values: { gameID: '1207664663', gameName: 'The Witcher 3', path: 'C:\\GOG Games\\The Witcher 3', exe: 'C:\\GOG Games\\The Witcher 3\\bin\\x64\\witcher3.exe', dependsOn: '' } },
        { name: '1', values: { gameID: '1', gameName: 'Hearts of Stone', path: 'C:\\GOG Games\\The Witcher 3', dependsOn: '1207664663' } },
        { name: '2', values: { gameName: 'Broken' } }
      ]
    })
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({ source: 'gog', externalId: '1207664663', name: 'The Witcher 3' })
  })
})

describe('ea scanner', () => {
  it('finds EA games in the uninstall list and skips the EA app itself', () => {
    const entries = parseEaRegistry([
      {
        path: UNINSTALL,
        values: {},
        subkeys: [
          { name: 'a', values: { DisplayName: 'Battlefield 2042', Publisher: 'Electronic Arts', InstallLocation: 'C:\\EA Games\\Battlefield 2042\\', DisplayIcon: 'C:\\EA Games\\Battlefield 2042\\BF2042.exe,0' } },
          { name: 'b', values: { DisplayName: 'EA app', Publisher: 'Electronic Arts', InstallLocation: 'C:\\Program Files\\Electronic Arts\\EA Desktop' } },
          { name: 'c', values: { DisplayName: 'Notepad++', Publisher: 'Notepad++ Team', InstallLocation: 'C:\\npp' } },
          { name: 'd', values: { DisplayName: 'Apex Legends', Publisher: 'Respawn', UninstallString: '"C:\\Program Files\\Common Files\\EAInstaller\\Apex\\Cleanup.exe"', InstallLocation: 'C:\\Games\\Apex' } }
        ]
      },
      { path: 'HKLM\\SOFTWARE\\WOW6432Node\\EA Games', values: {}, subkeys: [{ name: 'Battlefield 2042', values: { 'Install Dir': 'C:\\EA Games\\Battlefield 2042' } }] }
    ])
    expect(entries.map((e) => e.name)).toEqual(['Battlefield 2042', 'Apex Legends'])
    expect(entries[0].displayIcon).toBe('C:\\EA Games\\Battlefield 2042\\BF2042.exe')
  })

  it('reads the launch exe from installerdata.xml', () => {
    const xml = '<game><runtime><launcher><filePath>[HKEY_LOCAL_MACHINE\\SOFTWARE\\EA Games\\Battlefield 4\\Install Dir]bf4.exe</filePath></launcher></runtime></game>'
    expect(parseInstallerData(xml)).toBe('bf4.exe')
  })
})

describe('ubisoft scanner', () => {
  it('pairs install folders with uninstall names', () => {
    const entries = parseUbisoftRegistry([
      { path: UBISOFT_INSTALLS_KEY, values: {}, subkeys: [
        { name: '5059', values: { InstallDir: 'C:/Program Files (x86)/Ubisoft/Ubisoft Game Launcher/games/Assassins_Creed_Valhalla/' } },
        { name: '720', values: { InstallDir: 'D:/Ubisoft/Far_Cry_5/' } }
      ] },
      { path: UNINSTALL, values: {}, subkeys: [{ name: 'Uplay Install 5059', values: { DisplayName: "Assassin's Creed Valhalla" } }] }
    ])
    expect(entries[0]).toMatchObject({ id: '5059', name: "Assassin's Creed Valhalla" })
    expect(entries[1].name).toBe('Far Cry 5') // falls back to the folder name
  })
})
