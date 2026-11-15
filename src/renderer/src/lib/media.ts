/**
 * URL for a stored image. On desktop, paths are relative to the media folder ("games/12/cover-1a2b3c.jpg").
 * On Android, artwork is kept as web addresses, and app icons as files on the phone.
 */
export function mediaUrl(path: string | null): string | null {
  if (!path) return null
  if (/^(https?:|data:|blob:)/i.test(path)) return path
  if (path.startsWith('file://')) {
    const cap = (window as { Capacitor?: { convertFileSrc?: (p: string) => string } }).Capacitor
    return cap?.convertFileSrc ? cap.convertFileSrc(path) : path
  }
  return `vanity-media://media/${path.split('/').map(encodeURIComponent).join('/')}`
}

/** A stable hue per game name, for placeholder art until real artwork is downloaded. */
export function nameHue(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}
