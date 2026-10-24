/** URL for a cached image. Paths are relative to the media folder, e.g. "games/12/cover-1a2b3c.jpg". */
export function mediaUrl(path: string | null): string | null {
  return path ? `vanity-media://media/${path.split('/').map(encodeURIComponent).join('/')}` : null
}

/** A stable hue per game name, for placeholder art until real artwork is downloaded. */
export function nameHue(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}
