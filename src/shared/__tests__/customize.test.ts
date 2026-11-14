import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, sanitizeProfile } from '../profile'
import { DEFAULT_UI, orderedNav, sanitizeUi } from '../ui'

describe('profile style', () => {
  it('keeps known choices and drops everything else', () => {
    expect(sanitizeProfile(undefined)).toEqual(DEFAULT_PROFILE)
    expect(sanitizeProfile({ banner: 'galaxy', frame: 'rainbow', nameStyle: 'glitch', effect: 'sparkle', flair: '👑', tagline: '  gg   wp  ' })).toEqual({
      banner: 'galaxy', frame: 'rainbow', nameStyle: 'glitch', effect: 'sparkle', flair: '👑', tagline: 'gg wp'
    })
    // Unknown IDs (say, from a newer version or a tampered server answer) fall back to the defaults.
    const odd = sanitizeProfile({ banner: '<img>', frame: 42, nameStyle: 'comic', effect: null, flair: 'lol', tagline: 'x'.repeat(200) })
    expect(odd).toMatchObject({ banner: 'theme', frame: 'accent', nameStyle: 'plain', effect: 'none', flair: '' })
    expect(odd.tagline).toHaveLength(60)
  })
})

describe('launcher options', () => {
  it('fills in defaults and clamps what it is given', () => {
    expect(sanitizeUi(undefined)).toEqual(DEFAULT_UI)
    const ui = sanitizeUi({ accent: '#12ABef', corners: 'pointy', scale: 300, background: 'stars', hiddenNav: ['/store', '/library', '/nope', '/store'], reduceMotion: 'yes' })
    expect(ui.accent).toBe('#12abef')
    expect(ui.corners).toBe('soft')
    expect(ui.scale).toBe(125)
    expect(ui.background).toBe('stars')
    expect(ui.hiddenNav).toEqual(['/store']) // the Library can't be hidden; unknown and repeated entries go
    expect(ui.reduceMotion).toBe(false)
    expect(sanitizeUi({ accent: 'red' }).accent).toBe('')
  })

  it('orders the sidebar and leaves hidden entries out', () => {
    const ui = sanitizeUi({ navOrder: ['/stats', '/library'], hiddenNav: ['/store', '/trending'] })
    expect(orderedNav(ui).map((m) => m.path)).toEqual(['/stats', '/library', '/friends', '/recent', '/favorites'])
    expect(orderedNav(DEFAULT_UI)).toHaveLength(7)
  })
})
