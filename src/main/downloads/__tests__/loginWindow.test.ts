import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, safeStorage: {}, session: {} }))

import { browserUserAgent, isWebAddress } from '../desktop'

describe('store sign-in windows', () => {
  it('introduce themselves as plain Chrome, so sign-in pages accept them', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) vanity/0.15.0 Chrome/134.0.6998.205 Electron/35.7.5 Safari/537.36'
    expect(browserUserAgent(ua)).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.205 Safari/537.36')
    expect(browserUserAgent(ua.replace('vanity/', 'Vanity/'))).not.toMatch(/vanity|electron/i)
  })

  it('let "more sign-in options" open web pages in a pop-up, and nothing else', () => {
    for (const url of ['https://accounts.google.com/o/oauth2/auth?x=1', 'https://appleid.apple.com/auth/authorize', 'http://localhost:1234/cb', 'about:blank']) expect(isWebAddress(url)).toBe(true)
    for (const url of ['file:///C:/Windows/system32/cmd.exe', 'javascript:alert(1)', 'steam://run/1', 'com.epicgames.launcher://x', '', 'not a url']) expect(isWebAddress(url)).toBe(false)
  })
})
