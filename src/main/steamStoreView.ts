import { app, shell, type WebContents } from 'electron'

/** Hosts the embedded Steam store may navigate to. Anything else opens in the browser. */
const STEAM_HOSTS = /^(store\.steampowered\.com|steampowered\.com|login\.steampowered\.com|checkout\.steampowered\.com|help\.steampowered\.com|steamcommunity\.com)$/

export function isSteamPage(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && STEAM_HOSTS.test(u.hostname)
  } catch {
    return false
  }
}

function openOutside(url: string): void {
  if (/^(https?|steam):/i.test(url)) void shell.openExternal(url)
}

/**
 * Locks down <webview> guests: no preload or Node access, Steam pages only,
 * steam:// links go to the Steam app, other sites open in the default browser.
 */
export function secureWebviews(): void {
  app.on('web-contents-created', (_e, contents: WebContents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      if (!isSteamPage(params.src)) event.preventDefault()
    })

    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler(({ url }) => {
      // Store links that would open a new window load in place instead.
      if (isSteamPage(url)) void contents.loadURL(url)
      else openOutside(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (isSteamPage(url)) return
      event.preventDefault()
      openOutside(url)
    })
    contents.on('will-redirect', (event, url) => {
      if (isSteamPage(url) || /^https:\/\/[^/]*\.(steamstatic|steamcontent|akamaihd)\./.test(url)) return
      event.preventDefault()
      openOutside(url)
    })
  })
}
