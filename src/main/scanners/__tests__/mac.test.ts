import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { notPlayableHere, scanSourcesFor } from '@shared/types'
import { parseXmlPlist } from '../../mac/plist'
import { parsePsList } from '../../launcher/processes'
import { epicManifestDir } from '../epic'
import { parseGogInfo, scanMacGog } from '../gog'
import { appExternalId, isGameCategory, scanMacApps } from '../macApps'
import { macSteamRoot, scanSteamRoot } from '../steam'
import { scanCustomFolder } from '../custom'

const roots: string[] = []
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'vanity-test-mac-'))
  roots.push(d)
  return d
}
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true })
})

const plist = (entries: Record<string, string>, extra = ''): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${extra}${Object.entries(entries)
    .map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>\n`)
    .join('')}</dict>\n</plist>\n`

function makeApp(folder: string, name: string, info: string, resources: Record<string, string> = {}): string {
  const app = join(folder, `${name}.app`)
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'Info.plist'), info)
  for (const [file, text] of Object.entries(resources)) writeFileSync(join(app, 'Contents', 'Resources', file), text)
  return app
}

describe('Mac: reading apps', () => {
  it('reads the top-level keys of an Info.plist and skips nested ones', () => {
    const p = parseXmlPlist(plist({ CFBundleName: 'Hades', LSApplicationCategoryType: 'public.app-category.action-games' }, '\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleName</key>\n\t\t\t<string>WRONG</string>\n\t\t</dict>\n\t</array>\n\t<key>LSRequiresNativeExecution</key>\n\t<true/>\n'))
    expect(p).toMatchObject({ CFBundleName: 'Hades', LSApplicationCategoryType: 'public.app-category.action-games', LSRequiresNativeExecution: true })
  })

  it("knows Apple's game categories", () => {
    for (const c of ['public.app-category.games', 'public.app-category.action-games', 'public.app-category.role-playing-games', 'public.app-category.games ']) expect(isGameCategory(c)).toBe(true)
    for (const c of ['public.app-category.productivity', 'public.app-category.developer-tools', undefined, '']) expect(isGameCategory(c)).toBe(false)
  })

  it('finds games among the apps, one folder down too, and leaves GOG ones to GOG', async () => {
    const apps = temp()
    makeApp(apps, 'Hades', plist({ CFBundleIdentifier: 'com.supergiant.hades', CFBundleDisplayName: 'Hades', LSApplicationCategoryType: 'public.app-category.action-games' }))
    makeApp(apps, 'Pages', plist({ CFBundleIdentifier: 'com.apple.Pages', LSApplicationCategoryType: 'public.app-category.productivity' }))
    mkdirSync(join(apps, 'Publisher'))
    makeApp(join(apps, 'Publisher'), 'Stray', plist({ CFBundleName: 'Stray', LSApplicationCategoryType: 'public.app-category.adventure-games' }))
    makeApp(apps, 'Witcher', plist({ CFBundleName: 'The Witcher', LSApplicationCategoryType: 'public.app-category.role-playing-games' }), { 'goggame-1207664643.info': JSON.stringify({ gameId: '1207664643', name: 'The Witcher: Enhanced Edition' }) })
    const found = await scanMacApps([apps, join(apps, 'missing')])
    expect(found.map((g) => [g.source, g.name]).sort()).toEqual([['macapp', 'Hades'], ['macapp', 'Stray']])
    expect(found.find((g) => g.name === 'Hades')).toMatchObject({ externalId: 'com.supergiant.hades', installPath: join(apps, 'Hades.app'), executablePath: join(apps, 'Hades.app') })
    expect(appExternalId('/Applications/X.app', null)).toBe('/Applications/X.app')

    const gog = await scanMacGog([apps])
    expect(gog).toEqual([{ source: 'gog', externalId: '1207664643', name: 'The Witcher: Enhanced Edition', installPath: join(apps, 'Witcher.app'), executablePath: join(apps, 'Witcher.app') }])
  })

  it('skips GOG DLC info files and bad ones', () => {
    expect(parseGogInfo(JSON.stringify({ gameId: '2', rootGameId: '1', name: 'DLC' }), '/a.app')).toBeNull()
    expect(parseGogInfo('not json', '/a.app')).toBeNull()
    expect(parseGogInfo(JSON.stringify({ gameId: 5, name: ' Game ' }), '/a.app')).toMatchObject({ externalId: '5', name: 'Game' })
  })

  it('offers every app in a custom folder on a Mac', async () => {
    const folder = temp()
    makeApp(folder, 'Indie', plist({ CFBundleName: 'Indie Game' }))
    const found = await scanCustomFolder(folder, 'darwin')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ source: 'custom', name: 'Indie Game', installPath: join(folder, 'Indie.app'), executablePath: join(folder, 'Indie.app') })
  })
})

describe('Mac: launchers', () => {
  it("reads Steam's Mac library folder", async () => {
    const home = temp()
    const root = macSteamRoot(home)
    expect(root).toBe(join(home, 'Library', 'Application Support', 'Steam'))
    mkdirSync(join(root, 'steamapps', 'common', 'Hades'), { recursive: true })
    writeFileSync(join(root, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${root}"\n\t}\n}\n`)
    writeFileSync(join(root, 'steamapps', 'appmanifest_1145360.acf'), `"AppState"\n{\n\t"appid"\t\t"1145360"\n\t"name"\t\t"Hades"\n\t"StateFlags"\t\t"4"\n\t"installdir"\t\t"Hades"\n}\n`)
    expect(await scanSteamRoot(root)).toEqual([{ source: 'steam', externalId: '1145360', name: 'Hades', installPath: join(root, 'steamapps', 'common', 'Hades'), executablePath: null }])
  })

  it("points at the Epic Launcher's Mac manifests", () => {
    expect(epicManifestDir('darwin', '/Users/me')).toBe(join('/Users/me', 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'))
  })

  it('reads the running programs from ps', () => {
    expect(parsePsList('  101 /Applications/Hades.app/Contents/MacOS/Hades\n  202 /Users/me/Library/Application Support/Steam/steamapps/common/Stray/Stray.app/Contents/MacOS/Stray  \n  303 (kernel_task)\n')).toEqual([
      { pid: 101, path: '/Applications/Hades.app/Contents/MacOS/Hades' },
      { pid: 202, path: '/Users/me/Library/Application Support/Steam/steamapps/common/Stray/Stray.app/Contents/MacOS/Stray' }
    ])
  })
})

describe('which games run where', () => {
  it('greys out Windows programs on a Mac and Mac apps on Windows', () => {
    expect(notPlayableHere({ source: 'custom', executablePath: 'C:\\Games\\Doom\\doom.exe' }, 'darwin')).toBe('Windows only')
    expect(notPlayableHere({ source: 'ea', executablePath: null }, 'darwin')).toBe('Windows only')
    expect(notPlayableHere({ source: 'steam', executablePath: null }, 'darwin')).toBeNull()
    expect(notPlayableHere({ source: 'macapp', executablePath: '/Applications/Hades.app' }, 'darwin')).toBeNull()
    expect(notPlayableHere({ source: 'manual', executablePath: '/Games/index.html' }, 'darwin')).toBeNull()
    expect(notPlayableHere({ source: 'macapp', executablePath: '/Applications/Hades.app' }, 'win32')).toBe('Mac only')
    expect(notPlayableHere({ source: 'custom', executablePath: 'C:\\Games\\Doom\\doom.exe' }, 'win32')).toBeNull()
  })

  it('lists only the sources that can find anything on each computer', () => {
    expect(scanSourcesFor('darwin')).toEqual(['steam', 'epic', 'gog', 'macapp', 'custom'])
    expect(scanSourcesFor('win32')).toEqual(['steam', 'epic', 'gog', 'ea', 'ubisoft', 'custom'])
  })
})
