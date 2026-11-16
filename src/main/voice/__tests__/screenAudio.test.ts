import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => '/nowhere' } }))
const { helperArgs } = await import('../screenAudio')

describe('screen-share sound', () => {
  it('shares everything but Vanity for a screen, and only that program for a window', () => {
    expect(helperArgs('screen:0:0', 4242)).toEqual(['exclude', '4242'])
    expect(helperArgs('window:132456:0', 4242)).toEqual(['window', '132456', '4242'])
  })
  it('refuses anything else', () => {
    expect(helperArgs('window:abc:0', 1)).toBeNull()
    expect(helperArgs('& calc.exe', 1)).toBeNull()
  })
})
