import { describe, expect, it } from 'vitest'
import { DEFAULT_INTERFACE, normalizeInterface } from '../interfaceOptions'
import { DEFAULT_PROFILE_STYLE, normalizeProfileStyle, PROFILE_FLAIRS } from '../profileStyle'

describe('customize options', () => {
  it('start from the defaults, for a fresh install and for settings saved before they existed', () => {
    expect(normalizeInterface(undefined)).toEqual(DEFAULT_INTERFACE)
    expect(normalizeInterface({})).toEqual(DEFAULT_INTERFACE)
    expect(normalizeInterface('nonsense')).toEqual(DEFAULT_INTERFACE)
  })

  it('keep what was chosen and fill in anything missing', () => {
    const saved = normalizeInterface({ startPage: 'stats', hiddenNav: ['friends', 'store'], clock: '24', scale: 'compact', animations: false, jumpBackIn: false })
    expect(saved).toEqual({ ...DEFAULT_INTERFACE, startPage: 'stats', hiddenNav: ['store', 'friends'], clock: '24', scale: 'compact', animations: false, jumpBackIn: false })
  })

  it('keep the sidebar width between its narrowest and widest', () => {
    expect(normalizeInterface({ sidebarWidth: 300, sidebarCollapsed: true })).toMatchObject({ sidebarWidth: 300, sidebarCollapsed: true })
    expect(normalizeInterface({ sidebarWidth: 5 }).sidebarWidth).toBe(200)
    expect(normalizeInterface({ sidebarWidth: 9000 }).sidebarWidth).toBe(420)
    expect(normalizeInterface({ sidebarWidth: 'wide' }).sidebarWidth).toBe(240)
    expect(normalizeInterface({ sidebarWidth: 250.6 }).sidebarWidth).toBe(251)
  })

  it('drop values they do not know (a damaged file, or one from a newer Vanity)', () => {
    const saved = normalizeInterface({ startPage: 'settings', hiddenNav: ['library', 'friends', 7, 'friends'], clock: 'analog', scale: 'huge', corners: 5, animations: 'no', toasts: null })
    expect(saved).toEqual({ ...DEFAULT_INTERFACE, hiddenNav: ['friends'] })
    // Library can never be hidden, so there is always a way back.
    expect(saved.hiddenNav).not.toContain('library')
  })
})

describe('profile looks', () => {
  it('are complete, with only known values', () => {
    expect(normalizeProfileStyle(undefined)).toEqual(DEFAULT_PROFILE_STYLE)
    expect(normalizeProfileStyle({ banner: 'aurora', frame: 'rainbow', nameStyle: 'neon', flair: '🔥' })).toEqual({ banner: 'aurora', frame: 'rainbow', nameStyle: 'neon', flair: '🔥' })
    expect(normalizeProfileStyle({ banner: 'url(x)', frame: 3, nameStyle: 'comic sans', flair: '<b>' })).toEqual(DEFAULT_PROFILE_STYLE)
    expect(normalizeProfileStyle({ frame: 'gold' })).toEqual({ ...DEFAULT_PROFILE_STYLE, frame: 'gold' })
  })

  it('offer each emoji once', () => {
    expect(new Set(PROFILE_FLAIRS).size).toBe(PROFILE_FLAIRS.length)
  })
})
