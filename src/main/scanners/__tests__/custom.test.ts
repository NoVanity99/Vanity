import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanCustomFolder } from '../custom'
import { isLikelyNotGame, nameFromExecutable, pickMainExecutable, prettifyName } from '../../util/executables'
import { makeTree } from './helpers'

const MB = 1024 * 1024

describe('executable filtering', () => {
  it.each([
    'unins000.exe',
    'UnityCrashHandler64.exe',
    'CrashReportClient.exe',
    'vc_redist.x64.exe',
    'DXSETUP.exe',
    'EpicGamesLauncher.exe',
    'UbisoftConnectInstaller.exe',
    'dotNetFx40_Full_setup.exe',
    'EasyAntiCheat_EOS_Setup.exe',
    'BEService_x64.exe',
    'steamwebhelper.exe',
    'notification_helper.exe'
  ])('treats %s as not a game', (name) => {
    expect(isLikelyNotGame(join('/g', name))).toBe(true)
  })

  it.each(['Hades.exe', 'witcher3.exe', 'Cyberpunk2077.exe', 'eldenring.exe'])('keeps %s', (name) => {
    expect(isLikelyNotGame(join('/g', name))).toBe(false)
  })

  it('rejects anything inside redistributable folders', () => {
    expect(isLikelyNotGame('/g/Game/_CommonRedist/DotNet/4.8/thing.exe', '/g/Game')).toBe(true)
  })

  it('picks the shipping build over helpers, matching the game name', async () => {
    const root = makeTree({
      'Stray/Stray.exe': 1 * MB,
      'Stray/Hk_project/Binaries/Win64/Stray-Win64-Shipping.exe': 60 * MB,
      'Stray/Engine/Binaries/Win64/CrashReportClient.exe': 20 * MB,
      'Stray/Engine/Extras/Redist/en-us/UEPrereqSetup_x64.exe': 30 * MB
    })
    const best = await pickMainExecutable(join(root, 'Stray'), 'Stray')
    expect(best).toMatch(/Stray(-Win64-Shipping)?\.exe$/)
  })

  it('builds readable names', () => {
    expect(prettifyName('Hollow_Knight')).toBe('Hollow Knight')
    expect(prettifyName('HadesII')).toBe('Hades II')
    expect(nameFromExecutable('/Games/Celeste/bin/x64/Celeste.exe')).toBe('Celeste')
  })
})

describe('custom folder scanner', () => {
  it('treats each subfolder as a game and ignores junk-only folders', async () => {
    const root = makeTree({
      'Hollow Knight/hollow_knight.exe': 5 * MB,
      'Hollow Knight/UnityCrashHandler64.exe': 1 * MB,
      'Celeste/Celeste.exe': 3 * MB,
      'Celeste/unins000.exe': 1 * MB,
      'Redist/vc_redist.x64.exe': 10 * MB,
      'Tools/setup.exe': 1 * MB,
      'readme.txt': 'hi'
    })
    const found = await scanCustomFolder(root)
    expect(found.map((c) => c.name).sort()).toEqual(['Celeste', 'Hollow Knight'])
    const hk = found.find((c) => c.name === 'Hollow Knight')!
    expect(hk.executablePath).toMatch(/hollow_knight\.exe$/)
    expect(hk.alternatives).toEqual([])
    expect(hk.source).toBe('custom')
  })

  it('treats the folder itself as a game when it contains a game exe', async () => {
    const root = makeTree({ 'Terraria.exe': 5 * MB, 'Content/x.xnb': 'x' })
    const found = await scanCustomFolder(root)
    expect(found).toHaveLength(1)
    expect(found[0].executablePath).toBe(join(root, 'Terraria.exe'))
  })

  it('returns [] for a missing folder', async () => {
    expect(await scanCustomFolder('/nope/nope')).toEqual([])
  })
})
