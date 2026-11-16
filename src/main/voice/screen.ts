import { desktopCapturer, session } from 'electron'
import type { ScreenSource } from '@shared/ipc'

// Screen sharing in voice rooms (Windows). The window asks for the list of screens and windows,
// the person picks one in Vanity's own picker, then the window calls getDisplayMedia(), which
// lands here and gets the source that was picked. Nothing is captured without that pick.

let picked: { id: string; at: number } | null = null

/** Screens and open windows, with a small picture of each. */
export async function screenSources(): Promise<ScreenSource[]> {
  // Windows (and Linux) now and then answer with no screens at all for a moment, often right
  // after a share ends: ask again a couple of times before believing it.
  let sources: Electron.DesktopCapturerSource[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })
    } catch (err) {
      console.warn('[voice] listing screens failed:', err)
      sources = []
    }
    if (sources.some((s) => s.id.startsWith('screen:'))) break
    await new Promise((r) => setTimeout(r, 400))
  }
  return sources
    .filter((s) => s.name.trim() || s.id.startsWith('screen:'))
    .map((s, i) => ({
      id: s.id,
      name: s.id.startsWith('screen:') ? (sources.filter((x) => x.id.startsWith('screen:')).length > 1 ? `Screen ${i + 1}` : 'Entire screen') : s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
    }))
}

/** The next request to share (within half a minute) gets this screen or window. */
export function pickScreen(id: string): boolean {
  if (typeof id !== 'string' || !/^(screen|window):[\w:.-]{1,80}$/.test(id)) return false
  picked = { id, at: Date.now() }
  return true
}

export function setupScreenShare(): void {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const pick = picked && Date.now() - picked.at < 30_000 ? picked : null
    picked = null
    try {
      const source = pick ? (await desktopCapturer.getSources({ types: ['screen', 'window'] })).find((s) => s.id === pick.id) : undefined
      // No pick (or the window closed meanwhile): refused.
      if (!source) return callback({})
      callback({ video: source })
    } catch {
      callback({})
    }
  })
}
