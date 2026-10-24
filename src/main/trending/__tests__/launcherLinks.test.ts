import { describe, expect, it, vi } from 'vitest'
import { buildStoreLink, isStoreWebUrl, openStore, storeFromUrl } from '../launcherLinks'

describe('storeFromUrl', () => {
  it.each([
    ['https://store.steampowered.com/app/1245620/ELDEN_RING/', 'steam', '1245620'],
    ['https://store.epicgames.com/en-US/p/fortnite', 'epic', 'fortnite'],
    ['https://www.epicgames.com/store/en-US/product/rocket-league/home', 'epic', 'rocket-league'],
    ['https://www.gog.com/en/game/the_witcher_3_wild_hunt', 'gog', 'the_witcher_3_wild_hunt'],
    ['https://www.gog.com/game/cyberpunk_2077', 'gog', 'cyberpunk_2077'],
    ['https://www.ea.com/games/apex-legends', 'ea', 'apex-legends'],
    ['https://store.ubisoft.com/us/rainbow-six-siege/5643.html', 'ubisoft', 'us/rainbow-six-siege/5643.html'],
    ['https://shop.battle.net/en-us/product/overwatch', 'battlenet', 'en-us/product/overwatch'],
    ['https://apps.microsoft.com/detail/9nblggh4r315', 'microsoft', '9NBLGGH4R315'],
    ['https://www.xbox.com/en-US/games/store/forza-horizon-5/9NKX70BBCDRN', 'microsoft', '9NKX70BBCDRN']
  ])('%s → %s %s', (url, launcher, id) => {
    expect(storeFromUrl(url)).toMatchObject({ launcher, id })
  })

  it('ignores non-store URLs', () => {
    expect(storeFromUrl('https://store.steampowered.com/')).toBeNull()
    expect(storeFromUrl('https://twitter.com/eldenring')).toBeNull()
    expect(storeFromUrl('https://evil.example/store.steampowered.com/app/1')).toBeNull()
    expect(storeFromUrl('not a url')).toBeNull()
    expect(storeFromUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('deep links', () => {
  it('builds each launcher URI', () => {
    expect(buildStoreLink('steam', '620', null).deepLink).toBe('steam://store/620')
    expect(buildStoreLink('epic', 'fortnite', null).deepLink).toBe('com.epicgames.launcher://store/p/fortnite')
    expect(buildStoreLink('gog', '1207664663', 'https://www.gog.com/game/x').deepLink).toBe('goggalaxy://openGameView/1207664663')
    expect(buildStoreLink('gog', 'cyberpunk_2077', null).deepLink).toBeNull() // Galaxy needs a numeric ID
    expect(buildStoreLink('microsoft', '9NBLGGH4R315', null).deepLink).toBe('ms-windows-store://pdp/?productid=9NBLGGH4R315')
    expect(buildStoreLink('battlenet', 'x', 'https://shop.battle.net/x', 'overwatch-2').deepLink).toBe('battlenet://Pro')
    expect(buildStoreLink('ea', 'apex-legends', null)).toMatchObject({ deepLink: null, webUrl: 'https://www.ea.com/games/apex-legends' })
  })

  it('only trusts web URLs on the store\'s own hosts', () => {
    expect(isStoreWebUrl('steam', 'https://store.steampowered.com/app/1')).toBe(true)
    expect(isStoreWebUrl('steam', 'https://evil.example/app/1')).toBe(false)
    expect(isStoreWebUrl('steam', 'http://store.steampowered.com/app/1')).toBe(false)
  })
})

describe('openStore', () => {
  const steam = buildStoreLink('steam', '620', 'https://store.steampowered.com/app/620')

  it('opens the launcher when installed', async () => {
    const openExternal = vi.fn(async () => {})
    expect(await openStore(steam, { isInstalled: () => true, openExternal })).toBe('launcher')
    expect(openExternal).toHaveBeenCalledWith('steam://store/620')
  })

  it('opens the browser when the launcher is missing or the protocol fails', async () => {
    const openExternal = vi.fn(async () => {})
    expect(await openStore(steam, { isInstalled: () => false, openExternal })).toBe('browser')
    expect(openExternal).toHaveBeenLastCalledWith('https://store.steampowered.com/app/620')

    const failing = vi.fn(async (url: string) => {
      if (url.startsWith('steam:')) throw new Error('no handler')
    })
    expect(await openStore(steam, { isInstalled: () => true, openExternal: failing })).toBe('browser')
  })

  it('refuses a deep link for another protocol and a foreign web URL', async () => {
    const openExternal = vi.fn(async () => {})
    const forged = { launcher: 'steam' as const, storeId: null, deepLink: 'file:///C:/Windows/System32/calc.exe', webUrl: 'https://evil.example' }
    await expect(openStore(forged, { isInstalled: () => true, openExternal })).rejects.toThrow()
    expect(openExternal).not.toHaveBeenCalled()
  })
})
