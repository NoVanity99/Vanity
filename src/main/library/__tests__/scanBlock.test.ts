import { describe, expect, it } from 'vitest'
import { allowedApiRequest } from '../../../shared/apiPaths'
import { blockExe, exeName, normalizeExePath, unblockExe } from '../../../shared/scanBlock'
import { filterCandidates } from '../scan'
import type { GameCandidate } from '../../../shared/types'

const candidate = (folder: string, exe: string, alternatives: string[] = []): GameCandidate => ({ source: 'custom', externalId: `c:${folder}`, name: folder, installPath: `D:\\Games\\${folder}`, executablePath: `D:\\Games\\${folder}\\${exe}`, alternatives: alternatives.map((a) => `D:\\Games\\${folder}\\${a}`) }) as GameCandidate

describe('the scan block list', () => {
  it('matches the whole path, however it is written', () => {
    expect(normalizeExePath('D:\\Games\\Foo\\Game.EXE')).toBe(normalizeExePath('d:/games//foo/game.exe'))
    expect(normalizeExePath('D:\\Games\\Foo\\game.exe')).not.toBe(normalizeExePath('D:\\Games\\Bar\\game.exe'))
    expect(exeName('D:\\Games\\Foo\\Game.exe')).toBe('Game.exe')
    const list = blockExe(blockExe([], 'D:\\Games\\Foo\\Game.exe'), 'd:/games/foo/GAME.exe')
    expect(list).toEqual(['D:\\Games\\Foo\\Game.exe'])
    expect(unblockExe(list, 'D:/Games/Foo/game.exe')).toEqual([])
  })

  it('skips a blocked file in every scan, and only that file', () => {
    const found = [candidate('Foo', 'game.exe'), candidate('Bar', 'game.exe'), candidate('Tool', 'setup.exe', ['play.exe', 'crash.exe'])]
    const paths = (blocked: string[]): string[] => filterCandidates(found, [], blocked).map((c) => c.executablePath!)
    expect(paths([])).toHaveLength(3)
    // Two games with the same exe name: blocking one leaves the other.
    expect(paths(['d:/games/foo/GAME.EXE'])).toEqual(['D:\\Games\\Bar\\game.exe', 'D:\\Games\\Tool\\setup.exe'])
    // Blocking a folder's suggested file moves on to its next program; blocked ones aren't offered as choices either.
    const tool = filterCandidates(found, [], ['D:\\Games\\Tool\\setup.exe', 'D:\\Games\\Tool\\crash.exe']).find((c) => c.name === 'Tool')!
    expect([tool.executablePath, tool.alternatives]).toEqual(['D:\\Games\\Tool\\play.exe', []])
    expect(paths(['D:\\Games\\Tool\\setup.exe', 'D:\\Games\\Tool\\play.exe', 'D:\\Games\\Tool\\crash.exe'])).toHaveLength(2)
    // Removed from the list: found again next time.
    expect(paths(unblockExe(['d:/games/foo/GAME.EXE'], 'D:\\Games\\Foo\\game.exe'))).toHaveLength(3)
  })
})

describe('what the screens may ask the server directly', () => {
  it('lets through only the listed paths', () => {
    for (const [m, p] of [['GET', '/pulse'], ['GET', '/coins'], ['POST', '/coins/checkout'], ['GET', '/coins/history?before=12'], ['GET', '/games/~42/comments?before=7'], ['PATCH', '/comments/9'], ['POST', '/comments/9/report'], ['POST', '/voice/call'], ['POST', '/voice/rings/abc_DEF-12/decline'], ['GET', '/admin/users?page=0&q=ali%40x.com&filter=banned'], ['POST', '/admin/users/id-1/coins'], ['DELETE', '/admin/users/test-abc123'], ['GET', '/admin/users/id-1/view'], ['POST', '/admin/test-users']] as const) expect([p, allowedApiRequest(m, p)]).toEqual([p, true])
    for (const [m, p] of [['GET', '/me'], ['DELETE', '/me'], ['POST', '/sync'], ['GET', '/coins/../me'], ['POST', '/coins/grant'], ['GET', '/admin/users/x/../../me'], ['POST', '/admin/users/id-1/make-owner'], ['PUT', '/coins'], ['GET', 'https://evil.example/pulse'], ['GET', '/pulse?x=<script>'], ['GET', '/friends']] as const) expect([p, allowedApiRequest(m, p)]).toEqual([p, false])
  })
})
